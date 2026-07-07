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
  tectonicContext: z.string().trim().max(120).nullable().optional(),
  cue: editorialCueSchema
});
export type NarrationEditorial = {
  intro: string;
  closing: string | null;
  tectonicContext: string | null;
  cue: EditorialCue;
};
export type NarrationEditorialPreview = {
  raw: unknown;
  validated: NarrationEditorial;
  tectonicContextAccepted: boolean;
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
  "Evento sismico reciente"
] as const;
const FOLLOWUP_INTROS = [
  "Sismo detectado",
  "Evento sismico en seguimiento",
  "Actualizacion sismica"
] as const;
// Las aperturas se validan POR MODO: "Nuevo sismo..." solo es legitimo en breaking (sismo que
// recien ingresa). En seguimiento/recorrido solo caben las de FOLLOWUP, sin la palabra "nuevo".
const BREAKING_INTRO_SET = new Set<string>(BREAKING_INTROS.map(canonicalize));
const FOLLOWUP_INTRO_SET = new Set<string>(FOLLOWUP_INTROS.map(canonicalize));

function allowedIntroSet(mode: NarrationMode): Set<string> {
  return mode === "breaking" ? BREAKING_INTRO_SET : FOLLOWUP_INTRO_SET;
}

// Remates curados del evento (aprobados). Rotan con antirrepeticion (via lineas recientes) para
// que el cierre nunca canse; reemplazan al cierre libre de DeepSeek, que tendia a repetirse.
export const EVENT_CLOSINGS = [
  "Se mantiene la informacion a disposicion de la audiencia.",
  "La informacion se presenta con los datos disponibles al momento.",
  "Los datos pueden ajustarse si la fuente actualiza el evento.",
  "Registro incorporado al seguimiento sismico en tiempo real.",
  "El evento queda marcado dentro del monitoreo global."
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
const JAPAN_KEYWORDS = ["japon", "japan", "hokkaido", "honshu", "kyushu", "shikoku", "okinawa"] as const;
const ANDEAN_KEYWORDS = ["chile", "peru", "iquique", "arequipa", "arica", "antofagasta", "lima"] as const;
const MEXICO_KEYWORDS = [
  "mexico",
  "oaxaca",
  "guerrero",
  "chiapas",
  "michoacan",
  "colima",
  "jalisco"
] as const;
const ALASKA_KEYWORDS = ["alaska", "aleutian", "aleutianas", "anchorage", "adak"] as const;
const INDONESIA_KEYWORDS = [
  "indonesia",
  "sumatra",
  "java",
  "jawa",
  "sulawesi",
  "papua",
  "molucas",
  "molucca",
  "flores",
  "timor"
] as const;
const TURKEY_GREECE_KEYWORDS = ["turquia", "turkey", "grecia", "greece", "egeo", "aegean", "egean"] as const;
const CARIBBEAN_KEYWORDS = [
  "caribe",
  "puerto rico",
  "haiti",
  "republica dominicana",
  "dominican republic",
  "jamaica",
  "cuba",
  "guadalupe",
  "guadeloupe",
  "martinica",
  "martinique",
  "islas virgenes",
  "virgin islands"
] as const;
const OFFSHORE_PATTERN = /\b(costa|mar|estrecho|offshore|frente a la costa)\b/iu;
// Incluye tambien frases de "continuidad" de TV que no aplican a un directo 24/7 continuo:
// pausas, cortes comerciales, publicidad y despedidas del tipo "volvemos/regresamos".
const UNSUPPORTED_EDITORIAL_CLAIM_PATTERN =
  /\b(replic(?:a|as)|tsunami|dan(?:o|os)|victimas|heridos|alerta|evacua(?:cion|r)|riesgo|sin reportes?|pausa|comercial(?:es)?|publicidad|publicitari\w*|volvemos|volveremos|regresamos|regresaremos|informacion en desarrollo|(?:no (?:tenemos|hay)|sin) (?:mas|mayor) informacion|(?:seguimos|continuamos|seguiremos|continuaremos) (?:recopilando|reuniendo|recabando|ampliando) (?:la )?informacion|(?:seguimos|continuamos|mantenemos|se mantiene)\s+monitore\w*(?:\s+(?:continuo|continua|permanente|en vivo|en tiempo real|sismico))?|(?:centro|servicio|instituto|observatorio|agencia|autoridad(?:es)?|equipo|sala)\s+(?:sismolog\w*|geologic\w*|de monitoreo)|(?:nuestro|nuestra|este|esta)\s+(?:centro|servicio|instituto|observatorio|equipo)|seguimiento\s+(?:continuo|permanente))\b/u;
const SYSTEM_PROMPT =
  "Eres el editor de un canal sismico en directo 24/7. Debes devolver SOLO JSON valido con " +
  'este formato exacto: {"intro":"...","closing":"...","tectonicContext":"...","cue":{"urgency":"baja|media|alta","rhythm":"sereno|fluido|agil","tone":"sobrio|directo|calido"}}. ' +
  "Escribe en español correcto, con tildes y puntuacion natural. " +
  `Si modo es "breaking", intro debe ser exactamente una de: ${BREAKING_INTROS.join("; ")}. ` +
  `Si modo es "seguimiento", intro debe ser exactamente una de: ${FOLLOWUP_INTROS.join("; ")}. ` +
  'Nunca uses una apertura con la palabra "nuevo" cuando el modo es "seguimiento". ' +
  "No agregues lugar, pais, magnitud ni profundidad a intro. El campo closing debe ser siempre null: el remate final lo agrega el sistema. Usa las lineas recientes para evitar repeticiones de apertura, tono y contexto tectonico (tectonicContext). " +
  "Es un directo continuo 24/7 SIN cortes: nunca menciones pausas, cortes comerciales ni publicidad, ni digas que 'volvemos' o 'regresamos tras la pausa'. " +
  "Nunca uses formulas del tipo 'informacion en desarrollo', 'no tenemos mas informacion' ni variantes que sugieran que alguien esta reuniendo datos en tiempo real. " +
  "No hables en nombre de un centro sismologico, observatorio, instituto, servicio geologico, autoridades ni equipo de monitoreo. " +
  "No uses frases como 'seguimos monitoreando', 'monitoreo permanente', 'desde el centro sismologico' o similares. " +
  "La pista tectonica fue verificada previamente por las reglas regionales del sistema y sus datos pueden utilizarse. " +
  "tectonicContext debe ser null o UNA oracion oral completa de 8 a 16 palabras, con sujeto y verbo conjugado, que describa solo la pista tectonica verificada entregada. " +
  "Debe sonar natural al insertarse despues de la magnitud y la profundidad. Nunca devuelvas una etiqueta nominal como 'margen andino del Pacifico', 'Japon y el Pacifico occidental' o 'Turquia y el Egeo'. " +
  "Reformula la pista sin agregar mecanismos tectonicos ni nombres de placas que no aparezcan en ella: no conviertas fallas o convergencia en subduccion. " +
  "No repitas lugar, pais, magnitud ni profundidad dentro de tectonicContext. Si el contexto ya se uso en las lineas recientes, reformulalo sin cambiar el hecho tectonico. " +
  "No inventes replicas, danos, alertas, riesgo, tsunami, evacuaciones ni frases del tipo sin reportes.";

const TECTONIC_CONTEXT_MIN_WORDS = 8;
const TECTONIC_CONTEXT_MAX_WORDS = 16;
const TECTONIC_CONTEXT_VERB_PATTERN =
  /\b(es|esta|son|estan|ocurre|ocurren|corresponde|corresponden|refleja|reflejan|responde|responden|registra|registran|concentra|concentran|mantiene|mantienen|combina|combinan|presenta|presentan|experimenta|experimentan|genera|generan|provoca|provocan|produce|producen|origina|originan|causa|causan|contribuye|contribuyen|caracteriza|caracterizan|relaciona|relacionan|asocia|asocian|ubica|ubican|situa|situan|localiza|localizan|forma|forman|marca|marcan|vincula|vinculan|converge|convergen|interactua|interactuan|subduce|subducen|hunde|hunden|atraviesa|atraviesan)\b/u;
const TECTONIC_MECHANISM_PATTERNS = [
  /\bsubdu\w*\b/u,
  /\bfall\w*\b/u,
  /\bconverg\w*\b/u,
  /\bcolision\w*\b/u,
  /\bplac\w*\b/u,
  /\barco\w*\b/u,
  /\bmargen\w*\b/u,
  /\bcontinental\w*\b/u,
  /\bmarin\w*\b/u,
  /\bprofund\w*\b/u
] as const;
const TECTONIC_NAMED_ENTITY_PATTERNS = [
  /\bnazca\b/u,
  /\bcocos\b/u,
  /\bsudamerican\w*\b/u,
  /\bplaca\s+(?:del?|de la)\s+pacifico\b/u,
  /\bplaca\s+(?:del?|de la)\s+caribe\b/u,
  /\bplaca\s+filipina\b/u,
  /\bplaca\s+indoaustraliana\b/u
] as const;
const NARRATION_POLICY_VERSION = 2;

function normalizeEditorialText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!,;:]+$/u, "");
  return normalized || null;
}

function isCompleteSpokenTectonicContext(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const sentenceParts = value
    .split(/[.!?]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentenceParts.length !== 1) return false;
  const normalized = normalizeEditorialText(value);
  if (!normalized) return false;
  const wordCount = normalized.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  if (wordCount < TECTONIC_CONTEXT_MIN_WORDS || wordCount > TECTONIC_CONTEXT_MAX_WORDS) {
    return false;
  }
  return TECTONIC_CONTEXT_VERB_PATTERN.test(canonicalize(normalized));
}

function preservesTectonicMechanisms(candidate: string | null, deterministicContext: string | null): boolean {
  if (!candidate) return deterministicContext === null;
  if (!deterministicContext) {
    return !TECTONIC_MECHANISM_PATTERNS.some((pattern) => pattern.test(canonicalize(candidate)));
  }

  const foldedCandidate = canonicalize(candidate);
  const foldedDeterministic = canonicalize(deterministicContext);
  const candidateMechanisms = TECTONIC_MECHANISM_PATTERNS.filter((pattern) => pattern.test(foldedCandidate));
  const deterministicMechanisms = TECTONIC_MECHANISM_PATTERNS.filter((pattern) =>
    pattern.test(foldedDeterministic)
  );
  if (candidateMechanisms.some((candidatePattern) => !candidatePattern.test(foldedDeterministic))) {
    return false;
  }
  const candidateNamedEntities = TECTONIC_NAMED_ENTITY_PATTERNS.filter((pattern) =>
    pattern.test(foldedCandidate)
  );
  if (candidateNamedEntities.some((candidatePattern) => !candidatePattern.test(foldedDeterministic))) {
    return false;
  }
  return (
    deterministicMechanisms.length === 0 ||
    deterministicMechanisms.some((pattern) => pattern.test(foldedCandidate))
  );
}

function containsUnsupportedEditorialClaim(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(canonicalize(value));
}

function stripMarkdownFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
}

function buildNarrationRevision(request: NarrationRequest): string {
  return JSON.stringify({
    narrationPolicyVersion: NARRATION_POLICY_VERSION,
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
  fallback: NarrationEditorial,
  mode: NarrationMode
): Promise<NarrationEditorial | null> {
  if (!cacheDir) return null;
  const filePath = join(cacheDir, `${key}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return sanitizeNarrationEditorial(JSON.parse(await readFile(filePath, "utf8")), fallback, mode);
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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
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

function containsKeyword(text: string, keywords: readonly string[]): boolean {
  const normalized = canonicalize(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function inferRegionalTectonicHint(combined: string): TectonicHint | null {
  if (containsKeyword(combined, JAPAN_KEYWORDS)) {
    return {
      summary: "Japon y el Pacifico occidental",
      contextLine:
        "Japon registra sismicidad frecuente por la convergencia de placas en el Pacifico occidental"
    };
  }

  if (containsKeyword(combined, ANDEAN_KEYWORDS)) {
    return {
      summary: "margen andino del Pacifico",
      contextLine: "La subduccion de la placa de Nazca bajo la Sudamericana genera sismicidad en la region"
    };
  }

  if (containsKeyword(combined, MEXICO_KEYWORDS)) {
    return {
      summary: "Pacifico mexicano",
      contextLine: "El Pacifico mexicano registra sismicidad frecuente por subduccion frente a su costa"
    };
  }

  if (containsKeyword(combined, ALASKA_KEYWORDS)) {
    return {
      summary: "Alaska y arco Aleutiano",
      contextLine: "Alaska y el arco Aleutiano mantienen sismicidad frecuente en el Pacifico norte"
    };
  }

  if (containsKeyword(combined, INDONESIA_KEYWORDS)) {
    return {
      summary: "arco insular de Indonesia",
      contextLine:
        "Indonesia concentra sismicidad frecuente por varias zonas de subduccion en su arco insular"
    };
  }

  if (containsKeyword(combined, TURKEY_GREECE_KEYWORDS)) {
    return {
      summary: "Turquia y el Egeo",
      contextLine:
        "Turquia y el Egeo mantienen sismicidad frecuente por fallas activas y convergencia regional"
    };
  }

  if (containsKeyword(combined, CARIBBEAN_KEYWORDS)) {
    return {
      summary: "bordes de placa del Caribe",
      contextLine: "El Caribe combina fallas activas y subduccion, con sismicidad recurrente en sus bordes"
    };
  }

  return null;
}

function inferTectonicHint(request: NarrationRequest): TectonicHint {
  const place = canonicalize(request.normalizedPlace);
  const country = canonicalize(request.country ?? "");
  const combined = `${place} ${country}`;
  const depth = request.depthKm ?? null;
  const isMarine = OFFSHORE_PATTERN.test(request.normalizedPlace);
  const shallow = typeof depth === "number" && depth <= 70;
  const intermediate = typeof depth === "number" && depth > 70 && depth <= 300;
  const deep = typeof depth === "number" && depth > 300;
  const regional = inferRegionalTectonicHint(combined);

  if (regional) {
    return regional;
  }

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

function fallbackNarrationEditorial(request: NarrationRequest): NarrationEditorial {
  const recentLines = request.recentLines ?? [];
  const intro =
    request.mode === "breaking"
      ? pickNonRepeated(BREAKING_INTROS, recentLines)
      : pickNonRepeated(FOLLOWUP_INTROS, recentLines);
  const tectonicContext = inferTectonicHint(request).contextLine;
  return {
    intro,
    closing: null,
    tectonicContext,
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
  if (hint.contextLine) data.pista_tectonica = hint.contextLine;
  return `Contexto del aviso: ${JSON.stringify(data)}`;
}

export function sanitizeNarrationEditorial(
  raw: unknown,
  fallback: NarrationEditorial,
  mode: NarrationMode
): NarrationEditorial | null {
  const parsed = narrationEditorialSchema.safeParse(raw);
  if (!parsed.success) return null;

  const intro = normalizeEditorialText(parsed.data.intro);
  const closing = normalizeEditorialText(parsed.data.closing);
  const tectonicContext = normalizeEditorialText(parsed.data.tectonicContext);
  if (!intro) return null;
  if (
    containsUnsupportedEditorialClaim(intro) ||
    containsUnsupportedEditorialClaim(closing) ||
    containsUnsupportedEditorialClaim(tectonicContext)
  ) {
    return fallback;
  }
  // Intro valido SOLO si pertenece a las aperturas del modo: bloquea "Nuevo sismo..." en
  // seguimiento aunque la IA lo devuelva (fallback.intro ya es correcto por modo).
  const safeIntro = allowedIntroSet(mode).has(canonicalize(intro)) ? intro : fallback.intro;
  const safeTectonicContext =
    isCompleteSpokenTectonicContext(parsed.data.tectonicContext) &&
    preservesTectonicMechanisms(tectonicContext, fallback.tectonicContext)
      ? tectonicContext
      : fallback.tectonicContext;

  return {
    intro: safeIntro,
    closing,
    tectonicContext: safeTectonicContext,
    cue: parsed.data.cue
  };
}

async function resolveNarrationEditorial(request: NarrationRequest): Promise<NarrationEditorial> {
  const fallback = fallbackNarrationEditorial(request);
  const key = cacheKey(request);

  const memoryHit = memoryCache.get(key);
  if (memoryHit) return memoryHit;

  const diskHit = await readDiskCache(key, fallback, request.mode);
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
      sanitizeNarrationEditorial(JSON.parse(stripMarkdownFence(raw)), fallback, request.mode) ?? fallback;
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

export async function generateNarration(request: NarrationRequest): Promise<NarrationEditorial> {
  const base = await resolveNarrationEditorial(request);
  // El remate se elige fresco en cada narracion (fuera del cache): rota por los remates curados
  // evitando los que aparecen en las lineas recientes -> siempre varia, nunca cansa.
  return { ...base, closing: pickNonRepeated(EVENT_CLOSINGS, request.recentLines ?? []) };
}

export async function previewNarrationEditorial(
  request: NarrationRequest
): Promise<NarrationEditorialPreview> {
  if (!env.deepseekEnabled || !env.deepseekApiKey) {
    throw new Error("DeepSeek no esta habilitado para previsualizacion editorial");
  }
  if (!withinRateLimit()) {
    throw new Error("Limite temporal de DeepSeek alcanzado");
  }

  const fallback = fallbackNarrationEditorial(request);
  const rawText = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(request, inferTectonicHint(request)) }
    ],
    {
      maxTokens: Math.max(env.deepseekMaxTokens, 260),
      temperature: 0.68,
      timeoutMs: 15_000
    }
  );
  const raw = JSON.parse(stripMarkdownFence(rawText)) as unknown;
  const parsed = narrationEditorialSchema.safeParse(raw);
  const rawContext = parsed.success ? normalizeEditorialText(parsed.data.tectonicContext) : null;
  const validated = sanitizeNarrationEditorial(raw, fallback, request.mode) ?? fallback;
  const tectonicContextAccepted =
    parsed.success &&
    isCompleteSpokenTectonicContext(parsed.data.tectonicContext) &&
    preservesTectonicMechanisms(rawContext, fallback.tectonicContext) &&
    rawContext === validated.tectonicContext;

  return { raw, validated, tectonicContextAccepted };
}
