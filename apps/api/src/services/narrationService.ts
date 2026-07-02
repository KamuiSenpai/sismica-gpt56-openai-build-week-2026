import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LRUCache } from "lru-cache";
import { z } from "zod";

import { env } from "../config/env.js";
import { chat, DeepSeekUnavailableError } from "./deepseekClient.js";

export const editorialCueSchema = z.object({
  urgency: z.enum(["baja", "media", "alta"]),
  rhythm: z.enum(["sereno", "fluido", "agil"]),
  tone: z.enum(["sobrio", "directo", "calido"])
});
export type EditorialCue = z.infer<typeof editorialCueSchema>;

export const narrationModeSchema = z.enum(["breaking", "seguimiento"]);
export type NarrationMode = z.infer<typeof narrationModeSchema>;

export const narrationEditorialSchema = z.object({
  intro: z.string().trim().min(1).max(80),
  closing: z.string().trim().max(120).nullable().optional(),
  cue: editorialCueSchema
});
export type NarrationEditorial = {
  intro: string;
  closing: string | null;
  cue: EditorialCue;
};

export const narrationRequestSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  normalizedPlace: z.string().trim().min(1).max(240),
  country: z.string().trim().max(80).nullish(),
  mode: narrationModeSchema.default("seguimiento"),
  magnitude: z.number().finite().nullish(),
  depthKm: z.number().finite().nullish(),
  tsunami: z.boolean().optional(),
  eventTimeUtc: z.string().trim().min(1).max(40).optional(),
  updatedAtUtc: z.string().trim().min(1).max(40).nullish()
});
export type NarrationRequest = z.infer<typeof narrationRequestSchema>;

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const cacheDir = env.ttsCacheDir
  ? join(isAbsolute(env.ttsCacheDir) ? env.ttsCacheDir : resolve(REPO_ROOT, env.ttsCacheDir), "narration")
  : null;

const memoryCache = new LRUCache<string, NarrationEditorial>({ max: 500 });
let cacheDirReady: Promise<void> | null = null;

const UNSUPPORTED_EDITORIAL_CLAIM_PATTERN =
  /\b(replic(?:a|as)|tsunami|dan(?:o|os)|victimas|heridos|alerta|evacua(?:cion|r)|riesgo)\b/iu;
const SYSTEM_PROMPT =
  "Eres el editor de un canal sismico en directo 24/7. Debes devolver SOLO JSON valido con " +
  'este formato exacto: {"intro":"...","closing":"...","cue":{"urgency":"baja|media|alta","rhythm":"sereno|fluido|agil","tone":"sobrio|directo|calido"}}. ' +
  "No cambies magnitud, profundidad, pais, lugar ni hora. intro debe ser breve y locutable. " +
  "closing puede ser vacio o una frase corta de seguimiento. No inventes replicas, danos, " +
  "alertas, riesgo, tsunami ni evacuaciones.";

function fallbackNarrationEditorial(mode: NarrationMode): NarrationEditorial {
  if (mode === "breaking") {
    return {
      intro: "Nuevo sismo detectado",
      closing: "Seguimos monitoreando la zona",
      cue: { urgency: "alta", rhythm: "agil", tone: "directo" }
    };
  }
  return {
    intro: "Sismo detectado",
    closing: null,
    cue: { urgency: "media", rhythm: "fluido", tone: "sobrio" }
  };
}

function normalizeEditorialText(value: string | null | undefined, keepSentence = false): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!,;:]+$/u, "");
  if (!normalized) return null;
  return keepSentence ? normalized : normalized;
}

function stripMarkdownFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
}

function buildNarrationRevision(request: NarrationRequest): string {
  return JSON.stringify({
    eventId: request.eventId,
    title: request.title,
    normalizedPlace: request.normalizedPlace,
    country: request.country ?? null,
    mode: request.mode,
    magnitude: typeof request.magnitude === "number" ? Number(request.magnitude.toFixed(1)) : null,
    depthKm: typeof request.depthKm === "number" ? Math.round(request.depthKm) : null,
    tsunami: request.tsunami === true,
    eventTimeUtc: request.eventTimeUtc ?? null,
    updatedAtUtc: request.updatedAtUtc ?? null
  });
}

function cacheKey(request: NarrationRequest): string {
  return createHash("sha1").update(buildNarrationRevision(request)).digest("hex");
}

async function readDiskCache(key: string): Promise<NarrationEditorial | null> {
  if (!cacheDir) return null;
  const filePath = join(cacheDir, `${key}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return sanitizeNarrationEditorial(parsed, fallbackNarrationEditorial("seguimiento"));
  } catch {
    return null;
  }
}

async function writeDiskCache(key: string, editorial: NarrationEditorial): Promise<void> {
  if (!cacheDir) return;
  try {
    if (!cacheDirReady) cacheDirReady = mkdir(cacheDir, { recursive: true }).then(() => undefined);
    await cacheDirReady;
    await writeFile(join(cacheDir, `${key}.json`), JSON.stringify(editorial), "utf8");
  } catch {
    // Cache en disco best-effort.
  }
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

function buildUserMessage(request: NarrationRequest): string {
  const data: Record<string, unknown> = {
    modo: request.mode,
    lugar_normalizado: request.normalizedPlace
  };
  if (request.country) data.pais = request.country;
  if (typeof request.magnitude === "number") data.magnitud = Number(request.magnitude.toFixed(1));
  if (typeof request.depthKm === "number") data.profundidad_km = Math.round(request.depthKm);
  return `Contexto del aviso: ${JSON.stringify(data)}`;
}

function sanitizeNarrationEditorial(value: unknown, fallback: NarrationEditorial): NarrationEditorial | null {
  const parsed = narrationEditorialSchema.safeParse(value);
  if (!parsed.success) return null;
  const intro = normalizeEditorialText(parsed.data.intro);
  const closing = normalizeEditorialText(parsed.data.closing, true);
  if (!intro || UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(intro)) return fallback;
  if (closing && UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(closing)) {
    return { ...fallback, intro, cue: parsed.data.cue };
  }
  return { intro, closing, cue: parsed.data.cue };
}

export async function generateNarration(request: NarrationRequest): Promise<NarrationEditorial> {
  const fallback = fallbackNarrationEditorial(request.mode);
  const key = cacheKey(request);

  const memoryHit = memoryCache.get(key);
  if (memoryHit) return memoryHit;

  const diskHit = await readDiskCache(key);
  if (diskHit) {
    memoryCache.set(key, diskHit);
    return diskHit;
  }

  if (!env.deepseekEnabled || !env.deepseekApiKey || !withinRateLimit()) return fallback;

  try {
    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(request) }
      ],
      { maxTokens: Math.max(env.deepseekMaxTokens, 180), temperature: 0.65 }
    );
    const parsed = sanitizeNarrationEditorial(JSON.parse(stripMarkdownFence(raw)), fallback) ?? fallback;
    memoryCache.set(key, parsed);
    await writeDiskCache(key, parsed);
    return parsed;
  } catch (error) {
    if (!(error instanceof DeepSeekUnavailableError)) {
      console.warn("Fallo generando pauta editorial de narracion; se usara fallback local.", error);
    }
    return fallback;
  }
}
