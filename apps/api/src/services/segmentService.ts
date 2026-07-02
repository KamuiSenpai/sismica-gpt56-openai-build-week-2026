import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LRUCache } from "lru-cache";
import { z } from "zod";

import { env } from "../config/env.js";
import { chat, DeepSeekUnavailableError } from "./deepseekClient.js";

const bulletinWindowSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);
const editorialCueSchema = z.object({
  urgency: z.enum(["baja", "media", "alta"]),
  rhythm: z.enum(["sereno", "fluido", "agil"]),
  tone: z.enum(["sobrio", "directo", "calido"])
});

export type EditorialCue = z.infer<typeof editorialCueSchema>;
export type SegmentPacket = {
  text: string;
  cue: EditorialCue;
};

export const segmentRequestSchema = z.object({
  kind: z.enum(["resumen", "educativo", "recomendacion", "boletin"]),
  totalLastHour: z.number().int().nonnegative().nullish(),
  biggestMagnitude: z.number().finite().nullish(),
  biggestPlace: z.string().trim().max(200).nullish(),
  topic: z.string().trim().max(160).nullish(),
  windowMinutes: bulletinWindowSchema.optional(),
  currentCount: z.number().int().nonnegative().nullish(),
  previousCount: z.number().int().nonnegative().nullish(),
  activeAreas: z.array(z.string().trim().min(1).max(80)).max(5).optional(),
  regionalFocus: z.string().trim().max(120).nullish(),
  recentLines: z.array(z.string().trim().min(1).max(320)).max(20).optional()
});
export type SegmentRequest = z.infer<typeof segmentRequestSchema>;

export const handoffRequestSchema = z.object({
  currentHost: z.string().trim().min(1).max(80),
  nextHost: z.string().trim().min(1).max(80)
});
export type HandoffRequest = z.infer<typeof handoffRequestSchema>;
export type HandoffSegment = {
  overlayText: string;
  currentHostLine: string;
  nextHostLine: string;
};

type TopicVariants = { topic: string; fallbackVariants: string[] };
type SingleFallbackTopic = { topic: string; fallback: string };
type SegmentKind = SegmentRequest["kind"];

export const EDUCATIVO_TOPICS: SingleFallbackTopic[] = [
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

export const RECOMMENDATION_TOPICS: TopicVariants[] = [
  {
    topic: "durante el sismo",
    fallbackVariants: [
      "Durante el sismo, agachese, cubrase y sujetese. Alejese de ventanas y objetos que puedan caer.",
      "Si el movimiento ya comenzo, proteja cabeza y cuello, busque cobertura firme y mantengase lejos de vidrios.",
      "Mientras dura el sismo, no corra ni use ascensores. Resguarde su cuerpo bajo una mesa resistente o junto a un muro estructural."
    ]
  },
  {
    topic: "despues del sismo",
    fallbackVariants: [
      "Despues del sismo, revise rutas de salida, verifique danos y corte gas o energia si detecta fugas o chispas.",
      "Tras el movimiento, mantenga la calma, evalue lesiones y alejese de estructuras debilitadas antes de reingresar.",
      "Una vez terminado el sismo, use calzado, inspeccione su entorno y siga solo informacion oficial."
    ]
  },
  {
    topic: "zona costera y tsunami",
    fallbackVariants: [
      "Si se encuentra en costa y el sismo fue fuerte o prolongado, evacue hacia zonas altas sin esperar una alerta adicional.",
      "En sectores costeros, un sismo intenso puede preceder a un tsunami. Alejese del borde marino y siga rutas de evacuacion.",
      "Tras un sismo fuerte en la costa, priorice subir a terreno elevado y mantengase atento a instrucciones oficiales."
    ]
  },
  {
    topic: "vehiculo",
    fallbackVariants: [
      "Si conduce durante un sismo, reduzca velocidad, detengase en un lugar despejado y permanezca dentro del vehiculo.",
      "Ante un sismo mientras maneja, evite puentes, tuneles, postes y cables antes de detenerse con seguridad.",
      "Si el sismo lo sorprende al volante, orillese lejos de estructuras de riesgo y espere a que pase el movimiento."
    ]
  },
  {
    topic: "edificio y ascensores",
    fallbackVariants: [
      "Dentro de edificios, no use ascensores durante ni despues del sismo hasta que la estructura sea evaluada.",
      "Si esta en un edificio, mantengase lejos de ventanales y escaleras congestionadas mientras dura el movimiento.",
      "En inmuebles altos, resguardese en una zona segura interior y evite intentar evacuar en pleno sismo."
    ]
  }
];

const cache = new LRUCache<string, SegmentPacket>({ max: 200 });
const handoffCache = new LRUCache<string, HandoffSegment>({ max: 40 });
const variantsCache = new LRUCache<string, string[]>({ max: 100 });
const rotationState = new Map<string, number>();
const VARIANT_COUNT = 3;
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const cacheDir = env.ttsCacheDir
  ? join(isAbsolute(env.ttsCacheDir) ? env.ttsCacheDir : resolve(REPO_ROOT, env.ttsCacheDir), "segments")
  : null;
let cacheDirReady: Promise<void> | null = null;

const UNSUPPORTED_LIVE_CLAIM_PATTERN = /\breplic(?:a|as)\b/iu;
const UNSUPPORTED_EDITORIAL_CLAIM_PATTERN =
  /\b(replic(?:a|as)|tsunami|dan(?:o|os)|victimas|heridos|alerta|evacua(?:cion|r)|riesgo)\b/iu;
const SEGMENT_SYSTEM_PROMPT =
  "Eres el redactor de un canal sismico en directo 24/7. Debes devolver SOLO JSON valido con " +
  'este formato exacto: {"text":"...","cue":{"urgency":"baja|media|alta","rhythm":"sereno|fluido|agil","tone":"sobrio|directo|calido"}}. ' +
  "El texto debe ser breve, claro y listo para overlay y voz. Usa espanol neutro. Considera las lineas recientes solo para evitar repetir aperturas o remates. No inventes " +
  "replicas, danos, alertas, riesgo, tsunami ni evacuaciones.";
const HANDOFF_SYSTEM_PROMPT =
  "Eres el productor editorial de un canal sismico 24/7. Redacta un relevo breve y natural " +
  "entre dos locutores. Devuelve SOLO JSON valido con este formato exacto: " +
  '{"overlayText":"...","currentHostLine":"...","nextHostLine":"..."} ' +
  "Usa espanol neutro, tono profesional de broadcast y una sola frase por campo. " +
  "overlayText debe mencionar por nombre a ambos locutores. " +
  "currentHostLine es dicha por el locutor saliente y debe ceder la posta al locutor entrante, mencionandolo por nombre. " +
  "nextHostLine es dicha por el locutor entrante y debe tomar la posta, mencionando por nombre al locutor saliente. " +
  "No inventes sismos, replicas, danos, alertas, riesgos ni cifras.";
const RECOMMENDATION_SYSTEM_PROMPT =
  "Eres el redactor de recomendaciones sismicas para un canal de monitoreo en directo. " +
  "Debes reescribir solamente medidas de seguridad ya aprobadas, sin inventar consejos nuevos. " +
  "Genera variantes breves, claras y listas para overlay y voz. Devuelve SOLO JSON valido: " +
  '{"variants":["texto 1","texto 2","texto 3"]}.';

function defaultCueForRequest(request: SegmentRequest): EditorialCue {
  if (request.kind === "boletin") {
    if ((request.biggestMagnitude ?? 0) >= 6 || (request.currentCount ?? 0) >= 10) {
      return { urgency: "alta", rhythm: "agil", tone: "directo" };
    }
    if (request.windowMinutes === 60) return { urgency: "baja", rhythm: "sereno", tone: "sobrio" };
    if (request.windowMinutes === 30) return { urgency: "media", rhythm: "fluido", tone: "directo" };
    return { urgency: "media", rhythm: "agil", tone: "directo" };
  }
  if (request.kind === "resumen") return { urgency: "media", rhythm: "fluido", tone: "directo" };
  if (request.kind === "educativo") return { urgency: "baja", rhythm: "sereno", tone: "sobrio" };
  return { urgency: "media", rhythm: "fluido", tone: "sobrio" };
}

function fallbackPacket(request: SegmentRequest): SegmentPacket {
  return { text: fallbackText(request), cue: defaultCueForRequest(request) };
}

function cacheKey(kind: string, seed: string): string {
  return createHash("sha1").update(`${kind}|${seed}`).digest("hex");
}

function variantCacheKey(kind: SegmentKind, topic: string): string {
  return `${kind}:${topic.toLowerCase()}`;
}

async function readVariantDiskCache(key: string): Promise<string[] | null> {
  if (!cacheDir) return null;
  const filePath = join(cacheDir, `${cacheKey("variants", key)}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return normalizeVariants(parsed, []);
  } catch {
    return null;
  }
}

async function writeVariantDiskCache(key: string, variants: string[]): Promise<void> {
  if (!cacheDir) return;
  try {
    if (!cacheDirReady) cacheDirReady = mkdir(cacheDir, { recursive: true }).then(() => undefined);
    await cacheDirReady;
    await writeFile(join(cacheDir, `${cacheKey("variants", key)}.json`), JSON.stringify(variants), "utf8");
  } catch {
    // Cache en disco best-effort.
  }
}

function normalizeVariants(values: unknown[], fallbackVariants: string[]): string[] {
  const normalized = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().replace(/^["']+|["']+$/g, ""))
    .map((value) => value.replace(/^[-\d.)\s]+/u, "").trim())
    .filter(Boolean);
  const unique = Array.from(new Set(normalized));
  return unique.length > 0 ? unique.slice(0, VARIANT_COUNT) : fallbackVariants;
}

function nextVariant(key: string, variants: string[]): string {
  const current = rotationState.get(key) ?? 0;
  rotationState.set(key, current + 1);
  return variants[current % variants.length] ?? variants[0] ?? "";
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

function sanitizePlainText(text: string): string {
  return text
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripMarkdownFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSpeakerPrefix(text: string, speakerName: string): string {
  return text.replace(new RegExp(`^${escapeRegExp(speakerName)}\\s*[:,-]\\s*`, "iu"), "").trim();
}

function fallbackHandoffSegment(request: HandoffRequest): HandoffSegment {
  return {
    overlayText: `${request.currentHost} cede el monitoreo a ${request.nextHost}. Seguimos con cobertura sismica continua.`,
    currentHostLine: `${request.nextHost}, te cedo la posta del monitoreo. Seguimos atentos a cualquier actualizacion sismica.`,
    nextHostLine: `Con gusto, ${request.currentHost}. Tomo la posta y seguimos con el monitoreo sismico en tiempo real.`
  };
}

function buildHandoffUserMessage(request: HandoffRequest): string {
  return (
    `Locutor saliente: ${request.currentHost}. ` +
    `Locutor entrante: ${request.nextHost}. ` +
    "El primero entrega la posta y el segundo la toma con naturalidad."
  );
}

function handoffSeed(now = new Date()): string {
  const hour = now.toISOString().slice(0, 13);
  const slot = now.getUTCMinutes() >= 30 ? "30" : "00";
  return `${hour}:${slot}`;
}

function parseHandoffSegment(raw: string, request: HandoffRequest): HandoffSegment {
  const fallback = fallbackHandoffSegment(request);
  const yieldPattern = /\b(cedo|paso|entrego|dejo)\b/iu;
  const takePattern = /\b(gracias|tomo|recibo|continuo|seguimos)\b/iu;
  try {
    const parsed = JSON.parse(stripMarkdownFence(raw)) as {
      overlayText?: unknown;
      currentHostLine?: unknown;
      nextHostLine?: unknown;
    };
    let overlayText = typeof parsed.overlayText === "string" ? sanitizePlainText(parsed.overlayText) : "";
    const currentHostLine =
      typeof parsed.currentHostLine === "string"
        ? stripSpeakerPrefix(sanitizePlainText(parsed.currentHostLine), request.currentHost)
        : "";
    const nextHostLine =
      typeof parsed.nextHostLine === "string"
        ? stripSpeakerPrefix(sanitizePlainText(parsed.nextHostLine), request.nextHost)
        : "";
    if (!overlayText || !currentHostLine || !nextHostLine) return fallback;
    if (
      UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(overlayText) ||
      UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(currentHostLine) ||
      UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(nextHostLine)
    ) {
      return fallback;
    }
    const overlayLower = overlayText.toLowerCase();
    const currentLower = currentHostLine.toLowerCase();
    const nextLower = nextHostLine.toLowerCase();
    if (
      !overlayLower.includes(request.currentHost.toLowerCase()) ||
      !overlayLower.includes(request.nextHost.toLowerCase())
    ) {
      overlayText = fallback.overlayText;
    }
    if (
      !currentLower.includes(request.nextHost.toLowerCase()) ||
      !nextLower.includes(request.currentHost.toLowerCase())
    ) {
      return fallback;
    }
    if (!yieldPattern.test(currentHostLine) || !takePattern.test(nextHostLine)) {
      return fallback;
    }
    return { overlayText, currentHostLine, nextHostLine };
  } catch {
    return fallback;
  }
}

function recommendationTopic(topic: string | null | undefined): TopicVariants {
  return RECOMMENDATION_TOPICS.find((entry) => entry.topic === topic) ?? RECOMMENDATION_TOPICS[0];
}

function joinAreas(areas: string[] | undefined): string {
  const unique = Array.from(new Set((areas ?? []).map((area) => area.trim()).filter(Boolean))).slice(0, 3);
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0] as string;
  if (unique.length === 2) return `${unique[0]} y ${unique[1]}`;
  return `${unique[0]}, ${unique[1]} y ${unique[2]}`;
}

function comparisonText(currentCount: number, previousCount: number, windowMinutes: number): string {
  const delta = currentCount - previousCount;
  if (delta > 0) return `${delta} mas que en los ${windowMinutes} minutos previos`;
  if (delta < 0) return `${Math.abs(delta)} menos que en los ${windowMinutes} minutos previos`;
  return `sin cambio frente a los ${windowMinutes} minutos previos`;
}

function fallbackText(request: SegmentRequest): string {
  if (request.kind === "resumen") {
    const total = request.totalLastHour ?? 0;
    const base = `En la ultima hora se registraron ${total} sismos`;
    if (typeof request.biggestMagnitude === "number" && request.biggestPlace) {
      return `${base}; el mayor, magnitud ${request.biggestMagnitude.toFixed(1)} en ${request.biggestPlace}.`;
    }
    return `${base}.`;
  }

  if (request.kind === "boletin") {
    const windowMinutes = request.windowMinutes ?? 15;
    const currentCount = request.currentCount ?? 0;
    const previousCount = request.previousCount ?? 0;
    const comparison = comparisonText(currentCount, previousCount, windowMinutes);
    const areas = joinAreas(request.activeAreas);
    const parts = [`Boletin de ${windowMinutes} minutos: ${currentCount} sismos detectados, ${comparison}.`];
    if (typeof request.biggestMagnitude === "number" && request.biggestPlace) {
      parts.push(`La mayor magnitud fue ${request.biggestMagnitude.toFixed(1)} en ${request.biggestPlace}.`);
    }
    if (areas) {
      parts.push(`Actividad concentrada en ${areas}.`);
    } else if (request.regionalFocus) {
      parts.push(`Foco regional en ${request.regionalFocus}.`);
    }
    return parts.join(" ");
  }

  if (request.kind === "recomendacion") {
    const scenario = recommendationTopic(request.topic);
    return nextVariant(variantCacheKey("recomendacion", scenario.topic), scenario.fallbackVariants);
  }

  const found = EDUCATIVO_TOPICS.find((entry) => entry.topic === request.topic);
  return found?.fallback ?? EDUCATIVO_TOPICS[0].fallback;
}

function buildUserMessage(request: SegmentRequest): string {
  if (request.kind === "resumen") {
    const data: Record<string, unknown> = {
      pieza: "resumen del periodo",
      sismos_ultima_hora: request.totalLastHour ?? 0,
      lineas_recientes: (request.recentLines ?? []).slice(-12)
    };
    if (typeof request.biggestMagnitude === "number") data.mayor_magnitud = request.biggestMagnitude;
    if (request.biggestPlace) data.mayor_lugar = request.biggestPlace;
    return `Redacta el resumen operativo. Datos: ${JSON.stringify(data)}`;
  }

  if (request.kind === "boletin") {
    const data: Record<string, unknown> = {
      pieza: `boletin de ${request.windowMinutes ?? 15} minutos`,
      sismos_ventana_actual: request.currentCount ?? 0,
      sismos_ventana_previa: request.previousCount ?? 0,
      lineas_recientes: (request.recentLines ?? []).slice(-12)
    };
    if (typeof request.biggestMagnitude === "number") data.mayor_magnitud = request.biggestMagnitude;
    if (request.biggestPlace) data.mayor_lugar = request.biggestPlace;
    if ((request.activeAreas?.length ?? 0) > 0) data.zonas_activas = request.activeAreas;
    if (request.regionalFocus) data.foco_regional = request.regionalFocus;
    return `Redacta el boletin operativo. Datos: ${JSON.stringify(data)}`;
  }

  if (request.kind === "recomendacion") {
    const scenario = recommendationTopic(request.topic);
    const approvedMeasures = scenario.fallbackVariants
      .map((text, index) => `${index + 1}. ${text}`)
      .join(" ");
    return (
      `Genera ${VARIANT_COUNT} variantes breves de recomendacion sismica para el escenario ` +
      `"${scenario.topic}". Deben conservar estas medidas aprobadas y no agregar otras: ${approvedMeasures}`
    );
  }

  const topic = request.topic ?? EDUCATIVO_TOPICS[0].topic;
  return `Redacta un aviso breve de contexto sismico sobre el tema: "${topic}". Debe sonar util, directo y listo para pantalla y voz. Lineas recientes: ${JSON.stringify((request.recentLines ?? []).slice(-12))}`;
}

function parseRecommendationVariants(raw: string, fallbackVariants: string[]): string[] {
  const cleaned = raw.trim();
  try {
    const parsed = JSON.parse(cleaned) as { variants?: unknown };
    if (Array.isArray(parsed.variants)) {
      return normalizeVariants(parsed.variants, fallbackVariants);
    }
  } catch {
    // Sigue con el fallback de lineas libres.
  }
  return normalizeVariants(cleaned.split(/\r?\n+/u), fallbackVariants);
}

function sanitizeGeneratedSegmentPacket(raw: unknown, request: SegmentRequest): SegmentPacket {
  const fallback = fallbackPacket(request);
  const schema = z.object({
    text: z.string().trim().min(1).max(280),
    cue: editorialCueSchema
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fallback;
  const text = sanitizePlainText(parsed.data.text);
  if (!text) return fallback;
  if (request.kind !== "recomendacion" && UNSUPPORTED_LIVE_CLAIM_PATTERN.test(text)) return fallback;
  if (UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(text)) return fallback;
  return { text, cue: parsed.data.cue };
}

async function ensureRecommendationVariants(topic: string): Promise<string[]> {
  const scenario = recommendationTopic(topic);
  const key = variantCacheKey("recomendacion", scenario.topic);
  const memoryHit = variantsCache.get(key);
  if (memoryHit) return memoryHit;

  const diskHit = await readVariantDiskCache(key);
  if (diskHit) {
    variantsCache.set(key, diskHit);
    return diskHit;
  }

  if (!env.deepseekEnabled || !env.deepseekApiKey || !withinRateLimit()) {
    variantsCache.set(key, scenario.fallbackVariants);
    return scenario.fallbackVariants;
  }

  try {
    const raw = await chat(
      [
        { role: "system", content: RECOMMENDATION_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildUserMessage({ kind: "recomendacion", topic: scenario.topic })
        }
      ],
      { maxTokens: Math.max(env.deepseekMaxTokens, 180), temperature: 0.8 }
    );
    const variants = parseRecommendationVariants(raw, scenario.fallbackVariants);
    variantsCache.set(key, variants);
    await writeVariantDiskCache(key, variants);
    return variants;
  } catch (error) {
    if (!(error instanceof DeepSeekUnavailableError)) {
      console.warn("Fallo generando recomendaciones IA; se usaran variantes locales.", error);
    }
    variantsCache.set(key, scenario.fallbackVariants);
    return scenario.fallbackVariants;
  }
}

export async function warmRecommendationSegmentCache(): Promise<void> {
  for (const scenario of RECOMMENDATION_TOPICS) {
    await ensureRecommendationVariants(scenario.topic);
  }
}

export async function generateHandoffSegment(request: HandoffRequest): Promise<HandoffSegment> {
  const fallback = fallbackHandoffSegment(request);
  if (!env.deepseekEnabled || !env.deepseekApiKey) return fallback;

  const key = cacheKey("relevo", `${request.currentHost}|${request.nextHost}|${handoffSeed()}`);
  const hit = handoffCache.get(key);
  if (hit) return hit;

  if (!withinRateLimit()) return fallback;

  try {
    const raw = await chat(
      [
        { role: "system", content: HANDOFF_SYSTEM_PROMPT },
        { role: "user", content: buildHandoffUserMessage(request) }
      ],
      { maxTokens: Math.max(env.deepseekMaxTokens, 160), temperature: 0.85 }
    );
    const handoff = parseHandoffSegment(raw, request);
    handoffCache.set(key, handoff);
    return handoff;
  } catch (error) {
    if (!(error instanceof DeepSeekUnavailableError)) {
      console.warn("Fallo generando relevo IA; se usara la pauta local.", error);
    }
    return fallback;
  }
}

function segmentSeed(request: SegmentRequest): string {
  if (request.kind === "educativo") return request.topic ?? "educativo";
  return JSON.stringify({
    ...request,
    activeAreas: request.activeAreas?.slice(0, 3) ?? []
  });
}

export async function generateSegment(request: SegmentRequest): Promise<SegmentPacket> {
  if (request.kind === "recomendacion") {
    const scenario = recommendationTopic(request.topic);
    const variants = await ensureRecommendationVariants(scenario.topic);
    return {
      text: nextVariant(variantCacheKey("recomendacion", scenario.topic), variants),
      cue: defaultCueForRequest(request)
    };
  }

  const fallback = fallbackPacket(request);
  if (!env.deepseekEnabled || !env.deepseekApiKey) return fallback;

  const key = cacheKey(request.kind, segmentSeed(request));
  const hit = cache.get(key);
  if (hit) return hit;

  if (!withinRateLimit()) return fallback;

  try {
    const raw = await chat(
      [
        { role: "system", content: SEGMENT_SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(request) }
      ],
      {
        maxTokens: Math.max(env.deepseekMaxTokens, 220),
        temperature: request.kind === "educativo" ? 0.85 : 0.65
      }
    );
    const packet = sanitizeGeneratedSegmentPacket(JSON.parse(stripMarkdownFence(raw)), request);
    cache.set(key, packet);
    return packet;
  } catch (error) {
    if (!(error instanceof DeepSeekUnavailableError)) {
      console.warn("Fallo generando segmento IA; se usara la pauta local.", error);
    }
    return fallback;
  }
}
