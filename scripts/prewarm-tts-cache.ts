// Pre-calienta la cache de disco de Chatterbox con el contenido ESTATICO y verificable que
// el director puede emitir sin DeepSeek (las capsulas educativas de respaldo). Cuando DeepSeek
// esta lento o caido -el peor momento de latencia- estos segmentos suenan al instante (cache
// hit) en vez de disparar una generacion neural de ~30-35 s que deja aire muerto.
//
// Uso (con la API en :3000 y Chatterbox cargado):
//   npx tsx scripts/prewarm-tts-cache.ts --dry-run     # muestra textos/voces, no sintetiza
//   npx tsx scripts/prewarm-tts-cache.ts --limit 6     # calienta solo los primeros 6 clips
//   npx tsx scripts/prewarm-tts-cache.ts               # calienta todo (educativos x voces)
//
// IMPORTANTE: correr FUERA DE AIRE (con la voz de la pestana en pausa). Chatterbox genera en
// serie; si se calienta mientras la pestana reproduce, cada peticion compite por el motor y el
// oyente escuchara silencios. En una GPU tarda ~30-35 s por clip.

import { normalizeSpanishText } from "../apps/web/src/lib/spanishText";
import { normalizeSpokenText } from "../apps/web/src/lib/seismicSpeech";

const API_BASE = process.env.TTS_API_BASE ?? "http://localhost:3000";

// Fuente de verdad: EDUCATIVO_TOPICS[].fallback en apps/web/src/lib/broadcastDirector.ts.
// Si alli cambian, actualizar aqui (un desajuste solo significa que ese clip no se precalienta:
// degrada a generacion normal, nunca rompe).
const EDUCATIVO_FALLBACKS: readonly string[] = [
  "La escala de magnitud es logaritmica, cada punto equivale a unas treinta y dos veces mas energia liberada.",
  "La magnitud mide la energia del sismo, la intensidad, cuanto se sintio en cada lugar.",
  "La mayoria de los grandes terremotos ocurre donde una placa se hunde bajo otra, en zonas de subduccion.",
  "Un sismo emite ondas P rapidas y ondas S mas lentas; su diferencia de llegada revela la distancia al epicentro.",
  "Un sismo superficial suele sentirse mas que uno profundo de igual magnitud, porque la energia viaja menos.",
  "Un sismo submarino grande y superficial puede desplazar el agua y generar un tsunami.",
  "El Cinturon de Fuego del Pacifico concentra cerca del ochenta por ciento de los grandes terremotos.",
  "Que un sismo se sienta mas depende de su magnitud, profundidad, distancia y del tipo de suelo.",
  "El epicentro se obtiene combinando los tiempos de llegada de las ondas a varias estaciones."
] as const;

type HealthResponse = {
  engines?: { chatterbox?: { ok?: boolean; loaded?: boolean; profiles?: string[] } };
};

const args = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const dryRun = args.has("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit"));
const limit = limitArg
  ? Number.parseInt(limitArg.split("=")[1] ?? process.argv[process.argv.indexOf(limitArg) + 1] ?? "", 10)
  : Number.POSITIVE_INFINITY;

async function fetchProfiles(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/tts/health`);
  if (!res.ok) throw new Error(`/api/tts/health respondio ${res.status}`);
  const health = (await res.json()) as HealthResponse;
  const cb = health.engines?.chatterbox;
  if (!cb?.ok || !cb.loaded) throw new Error("Chatterbox no esta cargado; arranca el servicio primero.");
  const profiles = cb.profiles ?? [];
  if (profiles.length === 0) throw new Error("Chatterbox no reporta perfiles de voz.");
  return profiles;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Chatterbox genera en serie y rechaza (429) cualquier otra locucion mientras trabaja.
// Reintentamos el MISMO job hasta colarnos en una ventana libre, en vez de saltarlo.
async function warmOne(
  text: string,
  voice: string
): Promise<{ ms: number; cached: boolean; retries: number }> {
  const started = Date.now();
  const maxWaitMs = 90_000; // suficiente para superar una generacion en curso (~30-35 s)
  let retries = 0;
  for (;;) {
    const res = await fetch(`${API_BASE}/api/tts?engine=chatterbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice })
    });
    if (res.status === 429) {
      if (Date.now() - started > maxWaitMs) throw new Error(`motor ocupado > ${maxWaitMs / 1000}s`);
      retries += 1;
      await res.arrayBuffer();
      await sleep(1_500);
      continue;
    }
    if (!res.ok) throw new Error(`/api/tts (${voice}) respondio ${res.status}: ${await res.text()}`);
    const cached = res.headers.get("X-TTS-Cache") === "hit";
    await res.arrayBuffer();
    return { ms: Date.now() - started, cached, retries };
  }
}

async function main(): Promise<void> {
  const profiles = await fetchProfiles();
  // Replica EXACTA de lo que llega al /api/tts en vivo: el director hace
  // normalizeSpanishText(segment.text) en air() y luego la capa neural aplica
  // normalizeSpokenText antes de enviar. Misma composicion => misma clave de cache.
  const texts = EDUCATIVO_FALLBACKS.map((t) => normalizeSpokenText(normalizeSpanishText(t)));
  const jobs: Array<{ text: string; voice: string }> = [];
  for (const text of texts) for (const voice of profiles) jobs.push({ text, voice });
  const selected = jobs.slice(0, Number.isFinite(limit) ? limit : jobs.length);

  console.log(`API: ${API_BASE}  |  voces: ${profiles.join(", ")}`);
  console.log(
    `Clips estaticos: ${texts.length} x ${profiles.length} voces = ${jobs.length} (a calentar: ${selected.length})`
  );

  if (dryRun) {
    console.log("\n--- DRY RUN (no se sintetiza) ---");
    texts.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
    return;
  }

  console.log("\nCalentando en serie (Ctrl+C para abortar)...\n");
  let done = 0;
  let generated = 0;
  let cachedHits = 0;
  const t0 = Date.now();
  for (const job of selected) {
    done += 1;
    try {
      const { ms, cached, retries } = await warmOne(job.text, job.voice);
      if (cached) cachedHits += 1;
      else generated += 1;
      const tag = cached ? "cache" : "gen  ";
      const waited = retries > 0 ? ` (espero ${retries} turnos)` : "";
      console.log(
        `  [${done}/${selected.length}] ${tag} ${job.voice.padEnd(14)} ${(ms / 1000).toFixed(1)}s  ${job.text.slice(0, 42)}...${waited}`
      );
    } catch (err) {
      console.log(
        `  [${done}/${selected.length}] ERROR ${job.voice}: ${err instanceof Error ? err.message : err}`
      );
      await sleep(1_500);
    }
  }
  console.log(
    `\nListo en ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min  |  generados: ${generated}  ya-en-cache: ${cachedHits}`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
