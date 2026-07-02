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

const narrationFormatsSchema = z.object({
  overlay: z.string().trim().min(1).max(160),
  ticker: z.string().trim().min(1).max(180)
});

export const narrationEditorialSchema = z.object({
  intro: z.string().trim().min(1).max(80),
  closing: z.string().trim().max(120).nullable().optional(),
  tectonicContext: z.string().trim().max(120).nullable().optional(),
  formats: narrationFormatsSchema,
  cue: editorialCueSchema
});
export type NarrationEditorial = {
  intro: string;
  closing: string | null;
  tectonicContext: string | null;
  formats: {
    overlay: string;
    narration: string;
    ticker: string;
  };
  cue: EditorialCue;
};

export const narrationRequestSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(20),
  title: z.string().trim().min(1).max(300),
  normalizedPlace: z.string().trim().min(1).max(240),
  country: z.string().trim().max(80).nullish(),
  mode: narrationModeSchema.default("seguimiento"),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  magnitude: z.number().finite().nullish(),
  depthKm: z.number().finite().nullish(),
  recentLines: z.array(z.string().trim().min(1).max(320)).max(20).optional(),
  tsunami: z.boolean().optional(),
  eventTimeUtc: z.string().trim().min(1).max(40).optional(),
  updatedAtUtc: z.string().trim().min(1).max(40).nullish()
});
export type NarrationRequest = z.infer<typeof narrationRequestSchema>;

type TectonicHint = {
  summary: string;
  contextLine: string | null;
};

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const cacheDir = env.ttsCacheDir
  ? join(isAbsolute(env.ttsCacheDir) ? env.ttsCacheDir : resolve(REPO_ROOT, env.ttsCacheDir), "narration")
  : null;

const memoryCache = new LRUCache<string, NarrationEditorial>({ max: 500 });
let cacheDirReady: Promise<void> | null = null;

const BREAKING_INTROS = [
  "Nuevo sismo detectado",
  "Se registra un nuevo sismo",
  "Actualizacion sismica reciente",
  "Nuevo evento sismico en monitoreo"
] as const;
const BREAKING_CLOSINGS = [
  "Seguimos monitoreando la zona",
  "Se mantiene seguimiento sobre el area",
  "Monitoreo continuo sobre el sector"
] as const;
const FOLLOWUP_INTROS = [
  "Sismo detectado",
  "Evento sismico en seguimiento",
  "Reporte sismico en monitoreo"
] as const;

const SUBDUCTION_KEYWORDS = [
  "alaska",
  "aleutian",
  "aleutianas",
  "chile",
  "peru",
  "ecuador",
  "colombia",
  "mexico",
  "guatemala",
  "el salvador",
  "costa rica",
  "nicaragua",
  "japon",
  "japan",
  "taiwan",
  "filipinas",
  "philippines",
  "indonesia",
  "sumatra",
  "papua",
  "molucas",
  "molucca",
  "tonga",
  "vanuatu",
  "fiyi",
  "fiji",
  "nueva zelanda",
  "new zealand"
] as const;
const COLLISION_KEYWORDS = [
  "turquia",
  "turkey",
  "greece",
  "grecia",
  "italia",
  "italy",
  "iran",
  "afghanistan",
  "afganistan",
  "pakistan",
  "romania",
  "rumania",
  "albania",
  "cyprus",
  "chipre"
] as const;
const CONTINENTAL_KEYWORDS = [
  "polonia",
  "poland",
  "texas",
  "nevada",
  "utah",
  "mongolia",
  "kazajistan"
] as const;
const OFFSHORE_PATTERN = /\b(costa|mar|estrecho|offshore|frente a la costa)\b/iu;
const UNSUPPORTED_EDITORIAL_CLAIM_PATTERN =
  /\b(replic(?:a|as)|tsunami|dan(?:o|os)|victimas|heridos|alerta|evacua(?:cion|r)|riesgo)\b/iu;
const SYSTEM_PROMPT =
  "Eres el editor de un canal sismico en directo 24/7. Debes devolver SOLO JSON valido con " +
  'este formato exacto: {"intro":"...","closing":"...","tectonicContext":"...","formats":{"overlay":"...","ticker":"..."},"cue":{"urgency":"baja|media|alta","rhythm":"sereno|fluido|agil","tone":"sobrio|directo|calido"}}. ' +
  "No cambies magnitud, profundidad, pais, lugar ni hora. Usa las lineas recientes solo para evitar repeticiones de apertura, cierre y tono. " +
  "tectonicContext debe ser null o una sola frase breve basada SOLO en la pista tectonica entregada. No inventes replicas, danos, alertas, riesgo, tsunami ni evacuaciones.";

function normalizeEditorialText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!,;:]+$/u, "");
  return normalized || null;
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
    source: request.source,
    title: request.title,
    normalizedPlace: request.normalizedPlace,
    country: request.country ?? null,
    mode: request.mode,
    latitude: Number(request.latitude.toFixed(3)),
    longitude: Number(request.longitude.toFixed(3)),
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

async function readDiskCache(
  key: string,
  request: NarrationRequest,
  fallback: NarrationEditorial
): Promise<NarrationEditorial | null> {
  if (!cacheDir) return null;
  const filePath = join(cacheDir, `${key}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return sanitizeNarrationEditorial(JSON.parse(await readFile(filePath, "utf8")), request, fallback);
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

function canonicalize(text: string): string {
  return text
    .toLocaleLowerCase("es")
    .replace(/[.,;:!?]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function pickNonRepeated(candidates: readonly string[], recentLines: string[]): string {
  const canonHistory = recentLines.map(canonicalize);
  return (
    candidates.find((candidate) => {
      const canonCandidate = canonicalize(candidate);
      return !canonHistory.some((line) => line.includes(canonCandidate));
    }) ??
    candidates[0] ??
    ""
  );
}

function formatMagnitude(value: number | null | undefined): string | null {
  return typeof value === "number" ? `M${value.toFixed(1)}` : null;
}

function formatSpokenKilometers(value: number | null | undefined): string | null {
  if (typeof value !== "number") return null;
  const rounded = Math.round(value);
  return `${rounded} ${rounded === 1 ? "kilometro" : "kilometros"}`;
}

function formatShortDepth(value: number | null | undefined): string | null {
  if (typeof value !== "number") return null;
  return `${Math.round(value)} km`;
}

function containsKeyword(text: string, keywords: readonly string[]): boolean {
  const normalized = canonicalize(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function inferTectonicHint(request: NarrationRequest): TectonicHint {
  const place = canonicalize(request.normalizedPlace);
  const country = canonicalize(request.country ?? "");
  const combined = `${place} ${country}`;
  const depth = request.depthKm ?? null;
  const isMarine = OFFSHORE_PATTERN.test(request.normalizedPlace);
  const shallow = typeof depth === "number" && depth <= 35;
  const intermediate = typeof depth === "number" && depth > 35 && depth < 120;
  const deep = typeof depth === "number" && depth >= 120;

  if (containsKeyword(combined, SUBDUCTION_KEYWORDS)) {
    if (deep) {
      return {
        summary: "subduccion del Pacifico, foco profundo",
        contextLine: "Corresponde a un sismo profundo en margen de subduccion del Pacifico"
      };
    }
    if (intermediate) {
      return {
        summary: "subduccion del Pacifico, foco intermedio",
        contextLine: "Corresponde a un sismo de foco intermedio en margen de subduccion del Pacifico"
      };
    }
    return {
      summary: "subduccion del Pacifico",
      contextLine: "Evento asociado al margen de subduccion del Pacifico"
    };
  }

  if (containsKeyword(combined, COLLISION_KEYWORDS)) {
    return {
      summary: "franja de colision mediterraneo-asiatica",
      contextLine: "Evento asociado a la franja de colision mediterraneo-asiatica"
    };
  }

  if (containsKeyword(combined, CONTINENTAL_KEYWORDS) && shallow) {
    return {
      summary: "sismo continental superficial",
      contextLine: "Se trata de un sismo continental superficial"
    };
  }

  if (isMarine && shallow) {
    return {
      summary: "sismo marino superficial",
      contextLine: "Se trata de un sismo marino de poca profundidad"
    };
  }

  if (deep) {
    return {
      summary: "sismo profundo",
      contextLine: "Se trata de un sismo profundo"
    };
  }

  if (intermediate) {
    return {
      summary: "sismo de foco intermedio",
      contextLine: "Se trata de un sismo de foco intermedio"
    };
  }

  if (shallow) {
    return {
      summary: "sismo superficial",
      contextLine: "Se trata de un sismo superficial"
    };
  }

  return { summary: "sin contexto tectonico distintivo", contextLine: null };
}

function joinSentences(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => normalizeEditorialText(part))
    .filter((part): part is string => Boolean(part))
    .map((part) => `${part}.`)
    .join(" ");
}

function buildNarrationText(
  request: NarrationRequest,
  intro: string,
  tectonicContext: string | null,
  closing: string | null
): string {
  const parts = [`${intro} en ${request.normalizedPlace}`];
  const magnitude = formatMagnitude(request.magnitude);
  if (magnitude) parts.push(`de magnitud ${magnitude.replace(/^M/u, "")}`);
  const depth = formatSpokenKilometers(request.depthKm);
  if (depth) parts.push(`a una profundidad de ${depth}`);
  return joinSentences([parts.join(", "), tectonicContext, closing]);
}

function buildFallbackFormats(
  request: NarrationRequest,
  intro: string,
  narration: string,
  tectonicContext: string | null
): NarrationEditorial["formats"] {
  const magnitude = formatMagnitude(request.magnitude);
  const depth = formatShortDepth(request.depthKm);
  const overlay = joinSentences([
    magnitude ? `${magnitude} en ${request.normalizedPlace}` : `${intro} en ${request.normalizedPlace}`,
    tectonicContext
  ]);
  const tickerParts = [magnitude, request.normalizedPlace, depth ? `Prof. ${depth}` : null, tectonicContext]
    .filter((part): part is string => Boolean(part))
    .join(" | ");
  return {
    overlay,
    narration,
    ticker: tickerParts || request.normalizedPlace
  };
}

function fallbackNarrationEditorial(request: NarrationRequest): NarrationEditorial {
  const recentLines = request.recentLines ?? [];
  const intro =
    request.mode === "breaking"
      ? pickNonRepeated(BREAKING_INTROS, recentLines)
      : pickNonRepeated(FOLLOWUP_INTROS, recentLines);
  const closing = request.mode === "breaking" ? pickNonRepeated(BREAKING_CLOSINGS, recentLines) : null;
  const tectonicContext = inferTectonicHint(request).contextLine;
  const narration = buildNarrationText(request, intro, tectonicContext, closing);
  return {
    intro,
    closing,
    tectonicContext,
    formats: buildFallbackFormats(request, intro, narration, tectonicContext),
    cue:
      request.mode === "breaking"
        ? { urgency: "alta", rhythm: "agil", tone: "directo" }
        : { urgency: "media", rhythm: "fluido", tone: "sobrio" }
  };
}

function buildUserMessage(request: NarrationRequest, hint: TectonicHint): string {
  const data: Record<string, unknown> = {
    modo: request.mode,
    lugar_normalizado: request.normalizedPlace,
    source: request.source,
    latitud: Number(request.latitude.toFixed(3)),
    longitud: Number(request.longitude.toFixed(3)),
    lineas_recientes: (request.recentLines ?? []).slice(-12)
  };
  if (request.country) data.pais = request.country;
  if (typeof request.magnitude === "number") data.magnitud = Number(request.magnitude.toFixed(1));
  if (typeof request.depthKm === "number") data.profundidad_km = Math.round(request.depthKm);
  if (hint.contextLine) data.pista_tectonica = hint.summary;
  return `Contexto del aviso: ${JSON.stringify(data)}`;
}

function sanitizeNarrationEditorial(
  raw: unknown,
  request: NarrationRequest,
  fallback: NarrationEditorial
): NarrationEditorial | null {
  const parsed = narrationEditorialSchema.safeParse(raw);
  if (!parsed.success) return null;

  const intro = normalizeEditorialText(parsed.data.intro);
  const closing = normalizeEditorialText(parsed.data.closing);
  const tectonicContext = normalizeEditorialText(parsed.data.tectonicContext);
  const overlay = normalizeEditorialText(parsed.data.formats.overlay);
  const ticker = normalizeEditorialText(parsed.data.formats.ticker);
  if (!intro || !overlay || !ticker) return null;
  if (
    UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(intro) ||
    (closing && UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(closing)) ||
    (tectonicContext && UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(tectonicContext)) ||
    UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(overlay) ||
    UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(ticker)
  ) {
    return fallback;
  }

  const narration = buildNarrationText(request, intro, tectonicContext, closing);
  return {
    intro,
    closing,
    tectonicContext,
    formats: {
      overlay,
      narration,
      ticker
    },
    cue: parsed.data.cue
  };
}

export async function generateNarration(request: NarrationRequest): Promise<NarrationEditorial> {
  const fallback = fallbackNarrationEditorial(request);
  const key = cacheKey(request);

  const memoryHit = memoryCache.get(key);
  if (memoryHit) return memoryHit;

  const diskHit = await readDiskCache(key, request, fallback);
  if (diskHit) {
    memoryCache.set(key, diskHit);
    return diskHit;
  }

  if (!env.deepseekEnabled || !env.deepseekApiKey || !withinRateLimit()) return fallback;

  try {
    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(request, inferTectonicHint(request)) }
      ],
      { maxTokens: Math.max(env.deepseekMaxTokens, 260), temperature: 0.68 }
    );
    const parsed =
      sanitizeNarrationEditorial(JSON.parse(stripMarkdownFence(raw)), request, fallback) ?? fallback;
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
