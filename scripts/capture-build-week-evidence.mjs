import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = args.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function printHelp() {
  console.log(`Uso:
  node scripts/capture-build-week-evidence.mjs [opciones]

Opciones:
  --api-url=http://localhost:3000  API local configurada con OPENAI_ENABLED=true
  --output=output/build-week       Carpeta local de evidencia (ignorada por Git)
  --session-id=<uuid>              Identificador de la sesion Codex revisada
  --skip-api                       Captura commits y manifiesto sin llamar a OpenAI
  --help                           Muestra esta ayuda

El script llama al backend local, nunca lee OPENAI_API_KEY y nunca registra cabeceras.`);
}

if (args.includes("--help")) {
  printHelp();
  process.exit(0);
}

const apiUrl = option("api-url", "http://localhost:3000").replace(/\/$/, "");
const outputDir = resolve(option("output", "output/build-week"));
const sessionId = option("session-id", process.env.CODEX_SESSION_ID ?? null);
const skipApi = args.includes("--skip-api");

const sampleEvent = {
  eventId: "BUILD-WEEK:peru-demo-001",
  source: "IGP",
  title: "M4.8 - Costa de Arequipa, Peru",
  magnitude: 4.8,
  magnitudeType: "mb",
  depthKm: 38,
  latitude: -16.4,
  longitude: -73.1,
  eventTimeUtc: "2026-07-17T19:30:00.000Z",
  status: "reviewed",
  tsunami: false,
  sourceUrl: "https://ultimosismo.igp.gob.pe/"
};

function buildWeekCommits() {
  const output = execFileSync(
    "git",
    [
      "log",
      "--since=2026-07-17T00:00:00-05:00",
      "--until=2026-07-21T19:00:00-05:00",
      "--date=iso-strict",
      "--pretty=format:%H%x09%aI%x09%s"
    ],
    { encoding: "utf8" }
  ).trim();

  if (!output) return [];
  return output.split(/\r?\n/u).map((line) => {
    const [hash, authoredAt, ...subjectParts] = line.split("\t");
    return { hash, authoredAt, subject: subjectParts.join("\t") };
  });
}

async function captureOpenAiResponse() {
  const response = await fetch(`${apiUrl}/api/ai/explain-event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sampleEvent)
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = payload && typeof payload.error === "string" ? `: ${payload.error}` : "";
    throw new Error(`El endpoint respondio ${response.status}${detail}`);
  }
  if (payload?.provider !== "openai") throw new Error("La respuesta no identifica provider=openai");
  if (typeof payload.model !== "string" || !payload.model.startsWith("gpt-5.6")) {
    throw new Error(`Modelo inesperado: ${String(payload?.model)}`);
  }
  if (typeof payload.responseId !== "string" || !payload.responseId.startsWith("resp_")) {
    throw new Error("La respuesta no contiene un responseId real con prefijo resp_");
  }

  return payload;
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const commits = buildWeekCommits();
  if (commits.length === 0) {
    throw new Error("No se encontraron commits dentro de la ventana Build Week");
  }

  const openaiResponse = skipApi ? null : await captureOpenAiResponse();
  const generatedAtUtc = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    generatedAtUtc,
    buildWeekWindow: {
      startsAt: "2026-07-17T00:00:00-05:00",
      submissionDeadline: "2026-07-21T19:00:00-05:00"
    },
    codex: {
      sessionId,
      transcriptIncluded: false,
      note: "Revise el transcript local antes de compartirlo; este manifiesto no copia su contenido."
    },
    commits,
    openai: openaiResponse
      ? {
          status: "verified-real-response",
          simulated: false,
          provider: openaiResponse.provider,
          model: openaiResponse.model,
          responseId: openaiResponse.responseId,
          generatedAtUtc: openaiResponse.generatedAtUtc
        }
      : {
          status: "not-run",
          simulated: null,
          reason: "Ejecucion omitida con --skip-api"
        },
    secretHandling: {
      apiKeyReadByScript: false,
      authorizationHeaderCaptured: false
    }
  };

  await Promise.all([
    writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDir, "commits.json"), `${JSON.stringify(commits, null, 2)}\n`, "utf8"),
    openaiResponse
      ? writeFile(
          resolve(outputDir, "openai-response.json"),
          `${JSON.stringify({ request: sampleEvent, response: openaiResponse }, null, 2)}\n`,
          "utf8"
        )
      : Promise.resolve()
  ]);

  console.log(`Evidencia generada en ${outputDir}`);
  console.log(`Commits Build Week: ${commits.length}`);
  console.log(`Sesion Codex: ${sessionId ?? "no indicada"}`);
  console.log(
    openaiResponse
      ? `OpenAI verificado: ${openaiResponse.model} / ${openaiResponse.responseId}`
      : "OpenAI: no ejecutado (--skip-api)"
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
