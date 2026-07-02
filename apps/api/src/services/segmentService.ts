import { createHash } from "node:crypto";

import { LRUCache } from "lru-cache";
import { z } from "zod";

import { env } from "../config/env.js";
import { chat, DeepSeekUnavailableError } from "./deepseekClient.js";

// Segmentos de relleno/periodicos del directo (el director de eventos usa /api/narration).
export const segmentRequestSchema = z.object({
  kind: z.enum(["resumen", "educativo"]),
  totalLastHour: z.number().int().nonnegative().nullish(),
  biggestMagnitude: z.number().finite().nullish(),
  biggestPlace: z.string().trim().max(200).nullish(),
  topic: z.string().trim().max(160).nullish()
});
export type SegmentRequest = z.infer<typeof segmentRequestSchema>;

// Temas didacticos rotativos: la plantilla (fallback) ya es locutable; DeepSeek la reescribe
// variada. El cliente rota el indice; aqui se cachea por tema.
export const EDUCATIVO_TOPICS: Array<{ topic: string; fallback: string }> = [
  {
    topic: "escala de magnitud logaritmica",
    fallback:
      "La escala de magnitud es logaritmica: cada punto equivale a unas treinta y dos veces mas energia liberada."
  },
  {
    topic: "magnitud frente a intensidad",
    fallback:
      "La magnitud mide la energia del sismo; la intensidad, cuanto se sintio en un lugar. Un mismo sismo tiene una magnitud pero muchas intensidades."
  },
  {
    topic: "zonas de subduccion y placas",
    fallback:
      "La mayoria de los grandes terremotos ocurre donde una placa se hunde bajo otra, en las llamadas zonas de subduccion."
  },
  {
    topic: "ondas P y ondas S",
    fallback:
      "Un sismo emite ondas P, mas rapidas, y ondas S, mas lentas. La diferencia de llegada permite calcular la distancia al epicentro."
  },
  {
    topic: "profundidad del sismo",
    fallback:
      "Un sismo superficial suele sentirse mas fuerte que uno profundo de la misma magnitud, porque la energia viaja menos hasta la superficie."
  },
  {
    topic: "replicas tras un gran sismo",
    fallback:
      "Tras un gran terremoto es normal que ocurran replicas durante dias o semanas, generalmente de menor magnitud que el principal."
  },
  {
    topic: "tsunamis y sismos submarinos",
    fallback:
      "Un sismo submarino grande y superficial puede desplazar el agua y generar un tsunami; por eso se vigilan las costas tras estos eventos."
  },
  {
    topic: "cinturon de fuego del pacifico",
    fallback:
      "El Cinturon de Fuego del Pacifico concentra cerca del ochenta por ciento de los grandes terremotos del planeta."
  },
  {
    topic: "por que unos se sienten mas",
    fallback:
      "Que un sismo se sienta mas depende de su magnitud, su profundidad, la distancia y el tipo de suelo, que puede amplificar el movimiento."
  },
  {
    topic: "como se localiza un epicentro",
    fallback:
      "El epicentro se localiza combinando los tiempos de llegada de las ondas a varias estaciones, una triangulacion sismica."
  }
];

const cache = new LRUCache<string, string>({ max: 200 });

function cacheKey(kind: string, seed: string): string {
  return createHash("sha1").update(`${kind}|${seed}`).digest("hex");
}

let windowStart = 0;
let windowCount = 0;
function withinRateLimit(): boolean {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= env.deepseekRatePerMin) return false;
  windowCount += 1;
  return true;
}

const SYSTEM_PROMPT =
  "Eres el presentador de un canal de monitoreo sismico en directo 24/7. Escribe UNA pieza " +
  "breve (1 o 2 frases, maximo 35 palabras) en espanol neutro, natural y amena, lista para " +
  "locutar por voz. Sin emojis, sin markdown y sin comillas.";

function fallbackText(request: SegmentRequest): string {
  if (request.kind === "resumen") {
    const total = request.totalLastHour ?? 0;
    const base = `En la ultima hora se registraron ${total} sismos`;
    if (typeof request.biggestMagnitude === "number" && request.biggestPlace) {
      return `${base}; el mayor, magnitud ${request.biggestMagnitude.toFixed(1)} en ${request.biggestPlace}.`;
    }
    return `${base}.`;
  }
  const found = EDUCATIVO_TOPICS.find((entry) => entry.topic === request.topic);
  return found?.fallback ?? EDUCATIVO_TOPICS[0].fallback;
}

function buildUserMessage(request: SegmentRequest): string {
  if (request.kind === "resumen") {
    const data: Record<string, unknown> = {
      pieza: "resumen del periodo",
      sismos_ultima_hora: request.totalLastHour ?? 0
    };
    if (typeof request.biggestMagnitude === "number") data.mayor_magnitud = request.biggestMagnitude;
    if (request.biggestPlace) data.mayor_lugar = request.biggestPlace;
    return `Redacta el resumen. Datos: ${JSON.stringify(data)}`;
  }
  const topic = request.topic ?? EDUCATIVO_TOPICS[0].topic;
  return `Escribe un dato didactico breve de sismologia sobre el tema: "${topic}".`;
}

// Devuelve el texto del segmento: DeepSeek si esta disponible (cacheado), o la plantilla local.
export async function generateSegment(request: SegmentRequest): Promise<string> {
  if (!env.deepseekEnabled || !env.deepseekApiKey) return fallbackText(request);

  const seed = request.kind === "resumen" ? new Date().toISOString().slice(0, 13) : (request.topic ?? "0");
  const key = cacheKey(request.kind, seed);
  const hit = cache.get(key);
  if (hit) return hit;

  if (!withinRateLimit()) return fallbackText(request);

  try {
    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(request) }
      ],
      { maxTokens: env.deepseekMaxTokens, temperature: request.kind === "educativo" ? 0.9 : 0.7 }
    );
    const text = raw.replace(/^["']+|["']+$/g, "").trim();
    if (!text) return fallbackText(request);
    cache.set(key, text);
    return text;
  } catch (error) {
    if (!(error instanceof DeepSeekUnavailableError)) {
      console.warn("Fallo generando segmento IA; se usara la plantilla.", error);
    }
    return fallbackText(request);
  }
}
