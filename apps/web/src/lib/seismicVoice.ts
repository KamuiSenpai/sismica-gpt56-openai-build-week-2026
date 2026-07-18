// Orquestador de voz: elige el motor (Piper / XTTS-v2 / Navegador) y aplica un fallback
// en cascada. Re-exporta las mismas firmas que seismicSpeech.ts para que App.tsx solo
// cambie el import. seismicSpeech.ts (voz del navegador) queda intacto como RESPALDO.

import { type SeismicEvent } from "@sismica/shared";

import {
  claimVoiceOutput,
  fetchNarrationEditorial,
  fetchSeismicBridgeManifest,
  releaseVoiceOutput,
  reportVoiceTelemetry,
  type SeismicBridgeLibrary,
  type SeismicBridgeManifest,
  type SeismicBridgeManifestItem
} from "./api";
import { getRecentEditorialLines, rememberEditorialLine } from "./editorialHistory";
import { broadcastCountryName, broadcastPlace } from "./broadcastPlace";
import {
  buildDirectorV2GuidePlan,
  isDirectorV2GuideClipEligible,
  isDirectorV2TransitionClipEligible,
  selectDirectorV2GuideClass,
  shouldStartDirectorV2Guide,
  type DirectorV2GuideClassId,
  type DirectorV2GuidePriority
} from "./directorV2";
import {
  cueToVoiceDelivery,
  fallbackNarrationEditorial,
  type CueContextKind,
  type EditorialCue,
  type NarrationMode
} from "./editorial";
import { countryCode } from "./presentation";
import {
  activateTtsEngine,
  cancelNeuralNarration,
  fetchTtsHealth,
  getNeuralBlobState,
  getNeuralPlaybackState,
  isNeuralNarrationActive,
  prefetchNeural,
  speakNeural,
  type NeuralBlobReadyMetrics,
  type NeuralEngine,
  type TtsHealth
} from "./seismicNeuralSpeech";
import {
  buildSeismicNarration,
  cancelSeismicNarration as cancelBrowserNarration,
  isSeismicNarrationActive as isBrowserNarrationActive,
  isSeismicVoiceSupported as isBrowserVoiceSupported,
  normalizeChatterboxText,
  normalizeSpokenText,
  primeSeismicVoices as primeBrowserVoices,
  setSeismicVoiceEnabled as setBrowserVoiceEnabled,
  speakSeismicNarration as speakBrowserNarration,
  speakSeismicText as speakBrowserText
} from "./seismicSpeech";

export type VoiceEngine = "chatterbox" | "xtts" | "piper" | "browser";
export type BroadcastVoiceHostId = "carolina" | "liam" | "valentina" | "martin" | "sofia" | "ninoska";
export type BroadcastVoiceHost = {
  id: BroadcastVoiceHostId;
  name: string;
  xttsSpeaker: string;
  xttsProfile?: string;
};
export type ResolvedNarrationPacket = {
  text: string;
  cue: EditorialCue;
  tectonicContext: string | null;
};
export type ActiveEventNarrationPlayback = {
  eventId: string;
  engine: NeuralEngine;
  currentTimeMs: number;
  durationMs: number | null;
  playbackRate: number;
};
export type VoiceContinuityMode = "legacy" | "director-v2";
type VoiceContinuityOptions = {
  continuityMode?: VoiceContinuityMode;
  isHigherPriorityPending?: () => boolean;
};
type EventNarrationOptions = {
  intro?: string;
  closing?: string | null;
  mode?: NarrationMode;
  hostId?: BroadcastVoiceHostId;
  speaker?: string;
  resolved?: ResolvedNarrationPacket;
} & VoiceContinuityOptions;
type SpeakTextOptions = {
  hostId?: BroadcastVoiceHostId;
  speaker?: string;
  cue?: EditorialCue;
  kind?: CueContextKind;
  eventId?: string;
} & VoiceContinuityOptions;

export const VOICE_ENGINES: readonly VoiceEngine[] = ["chatterbox", "piper", "browser"] as const;
export const VOICE_ENGINE_LABELS: Record<VoiceEngine, string> = {
  chatterbox: "Chatterbox",
  xtts: "XTTS-v2",
  piper: "Piper",
  browser: "Navegador"
};
export const BROADCAST_VOICE_HOSTS: readonly BroadcastVoiceHost[] = [
  // xttsSpeaker es solo respaldo (voz incorporada de XTTS) si el perfil clonado no esta cargado.
  // El orden define la rotacion del relevo (cada uno cede la posta al siguiente).
  { id: "carolina", name: "Carolina", xttsSpeaker: "Claribel Dervla", xttsProfile: "mx_carolina" },
  { id: "liam", name: "Liam", xttsSpeaker: "Andrew Chipper", xttsProfile: "mx_liam" },
  { id: "valentina", name: "Valentina", xttsSpeaker: "Daisy Studious", xttsProfile: "mx_valentina" },
  { id: "martin", name: "Martin", xttsSpeaker: "Damien Black", xttsProfile: "mx_martin" },
  { id: "sofia", name: "Sofia", xttsSpeaker: "Gracie Wise", xttsProfile: "mx_sofia" },
  { id: "ninoska", name: "Ninoska", xttsSpeaker: "Alison Dietlinde", xttsProfile: "mx_ninoska" }
] as const;

// Orden de preferencia neural (autoseleccion y cascada de fallback): XTTS-v2 primero,
// luego Piper y, si todos fallan, la voz del navegador.
const NEURAL_PRIORITY: readonly NeuralEngine[] = ["chatterbox", "piper"] as const;
// Incluye frases de "continuidad" de TV que no aplican a un directo 24/7 continuo:
// pausas, cortes comerciales, publicidad y despedidas del tipo "volvemos/regresamos".
const UNSUPPORTED_EDITORIAL_CLAIM_PATTERN =
  /\b(replic(?:a|as)|tsunami|dan(?:o|os)|victimas|heridos|alerta|evacua(?:cion|r)|riesgo|sin reportes?|pausa|comercial(?:es)?|publicidad|publicitari\w*|volvemos|volveremos|regresamos|regresaremos|informacion en desarrollo|(?:no (?:tenemos|hay)|sin) (?:mas|mayor) informacion|(?:seguimos|continuamos|seguiremos|continuaremos) (?:recopilando|reuniendo|recabando|ampliando) (?:la )?informacion|(?:seguimos|continuamos|mantenemos|se mantiene)\s+monitore\w*(?:\s+(?:continuo|continua|permanente|en vivo|en tiempo real|sismico))?|(?:centro|servicio|instituto|observatorio|agencia|autoridad(?:es)?|equipo|sala)\s+(?:sismolog\w*|geologic\w*|de monitoreo)|(?:nuestro|nuestra|este|esta)\s+(?:centro|servicio|instituto|observatorio|equipo)|seguimiento\s+(?:continuo|permanente))\b/u;
// Aperturas validas POR MODO (espejo del API). "Nuevo sismo..." solo es legitimo en breaking
// (sismo que recien ingresa); en seguimiento/recorrido solo caben las de FOLLOWUP.
const BREAKING_LIVE_INTROS = [
  "Nuevo sismo detectado",
  "Se registra un nuevo sismo",
  "Actualizacion sismica reciente",
  "Evento sismico reciente"
] as const;
const FOLLOWUP_LIVE_INTROS = [
  "Sismo detectado",
  "Evento sismico en seguimiento",
  "Actualizacion sismica"
] as const;
const BREAKING_EDITORIAL_INTROS = new Set(BREAKING_LIVE_INTROS.map((value) => value.toLocaleLowerCase("es")));
const FOLLOWUP_EDITORIAL_INTROS = new Set(FOLLOWUP_LIVE_INTROS.map((value) => value.toLocaleLowerCase("es")));

function allowedEditorialIntros(mode: NarrationMode): Set<string> {
  return mode === "breaking" ? BREAKING_EDITORIAL_INTROS : FOLLOWUP_EDITORIAL_INTROS;
}
const LOCATION_NOISE_TERMS = new Set([
  "a",
  "al",
  "area",
  "actualizacion",
  "actualizacionsismica",
  "baja",
  "cerca",
  "continuo",
  "de",
  "del",
  "desde",
  "detectado",
  "directo",
  "el",
  "en",
  "evento",
  "foco",
  "frente",
  "intermedio",
  "km",
  "kilometro",
  "kilometros",
  "la",
  "magnitud",
  "media",
  "monitoreo",
  "nuevo",
  "oeste",
  "profundidad",
  "region",
  "reporte",
  "seguimiento",
  "sismo",
  "sur",
  "zona"
]);

const STORAGE_KEY = "sismica.voiceEngine";
const SPEECH_DEDUP_WINDOW_MS = 4_000;
const NARRATION_CACHE_LIMIT = 24;
const BRIDGE_START_DELAY_MS = 60;
const BRIDGE_INTER_CLIP_GAP_MS = 650;
const BRIDGE_DIALOGUE_HANDOFF_GAP_MS = 300;
const BRIDGE_FADE_OUT_MS = 180;
const BRIDGE_FINISH_FALLBACK_TIMEOUT_MS = 120_000;
const BRIDGE_TRANSITION_FINISH_TIMEOUT_MS = 15_000;
const BRIDGE_FALLBACK_GROUP = "continuidad_neutra";
const TRIAL_GUIDE_GROUP = "station_identity";
const INFORMATIVE_GUIDE_LIBRARY: SeismicBridgeLibrary = "informative";
const EDUCATIONAL_GUIDE_LIBRARY: SeismicBridgeLibrary = "educational";
const OFFICIAL_INFORMATIVE_GUIDE_LIBRARY: SeismicBridgeLibrary = "official-informative";
const OFFICIAL_EDUCATIONAL_GUIDE_LIBRARY: SeismicBridgeLibrary = "official-educational";
const OFFICIAL_PROMOTIONAL_GUIDE_LIBRARY: SeismicBridgeLibrary = "official-promotional";
const DIRECTOR_V2_GUIDE_SET =
  (import.meta as ImportMeta & { env?: { VITE_DIRECTOR_V2_GUIDE_SET?: string } }).env
    ?.VITE_DIRECTOR_V2_GUIDE_SET === "official"
    ? "official"
    : "trial";
const BRIDGE_SHORT_ONLY_MAX_WORDS = 18;
const BRIDGE_SINGLE_EXTENDED_MAX_WORDS = 30;
const BRIDGE_DOUBLE_EXTENDED_MAX_WORDS = 48;
const GUIDE_LONG_TEXT_MIN_WORDS = 64;
const BRIDGE_MAX_ELAPSED_SHORT_TEXT_MS = 20_000;
const BRIDGE_MAX_ELAPSED_MEDIUM_TEXT_MS = 30_000;
const BRIDGE_MAX_ELAPSED_LONG_TEXT_MS = 38_000;
const BRIDGE_MAX_ELAPSED_STATION_TEXT_MS = 46_000;
const BRIDGE_MAX_ELAPSED_DOUBLE_STATION_TEXT_MS = 52_000;
// Techo absoluto del presupuesto de puentes cuando hay muestras reales de latencia.
// Deja que los puentes cubran generaciones lentas (~50-55 s) que superan el hardcap por
// nº de palabras, pero acota el relleno si la generacion falla del todo (no rellenar sin fin).
const BRIDGE_ADAPTIVE_BUDGET_CEILING_MS = 90_000;
const BRIDGE_MIN_ELAPSED_SHORT_TEXT_MS = 16_000;
const BRIDGE_MIN_ELAPSED_MEDIUM_TEXT_MS = 24_000;
const BRIDGE_MIN_ELAPSED_LONG_TEXT_MS = 30_000;
const BRIDGE_MIN_ELAPSED_STATION_TEXT_MS = 32_000;
const BRIDGE_MIN_ELAPSED_DOUBLE_STATION_TEXT_MS = 38_000;
const BLOB_READY_SAMPLE_LIMIT = 24;
const BLOB_READY_VOICE_MIN_SAMPLES = 3;
const BLOB_READY_BUCKET_MIN_SAMPLES = 5;
const GUIDE_RECENT_HISTORY_LIMIT = 12;
const BRIDGE_CLIP_REPEAT_WINDOW_MS = 60 * 60_000;
const SUBDUCTION_BRIDGE_KEYWORDS = [
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
const COLLISION_BRIDGE_KEYWORDS = [
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
const CONTINENTAL_BRIDGE_KEYWORDS = [
  "polonia",
  "poland",
  "texas",
  "nevada",
  "utah",
  "mongolia",
  "kazajistan"
] as const;
const OFFSHORE_BRIDGE_PATTERN = /\b(costa|mar|estrecho|offshore|frente a la costa)\b/iu;

let voiceEnabled = false;
let engineExplicit = false;
let voiceEngine: VoiceEngine = loadEngine();
let healthSnapshot: TtsHealth | null = null;
let lastSpeechKey = "";
let lastSpeechAt = 0;
let activeBroadcastHostId: BroadcastVoiceHostId = BROADCAST_VOICE_HOSTS[0].id;
// Secuencia de narraciones: al resolver el texto (IA es async) descarta las superadas.
let narrationSeq = 0;
let activeVoiceSessionCount = 0;
let activeBridgePlaybackCount = 0;
let activeEventNarrationPlayback: { eventId: string; engine: NeuralEngine; seq: number } | null = null;
const narrationCache = new Map<string, ResolvedNarrationPacket>();
const inFlightNarrations = new Map<string, Promise<ResolvedNarrationPacket>>();
const bridgeManifestCache = new Map<SeismicBridgeLibrary, Promise<SeismicBridgeManifest | null>>();
const lastBridgeCandidateKeyByPool = new Map<string, string>();
const bridgeCycleByPool = new Map<string, { signature: string; remainingKeys: string[] }>();
const recentBridgeCandidateKeysByPool = new Map<string, string[]>();
const bridgeCandidateSelectedAt = new Map<string, number>();
const guideVoiceCycleBySignature = new Map<string, string[]>();
const lastGuideVoiceBySignature = new Map<string, string>();
let directorV2GuideClassCursor = 0;
let directorV2PlayedGuideCount = 0;
let directorV2PromotionalGuideCount = 0;
const VOICE_TELEMETRY_CLIENT_ID =
  globalThis.crypto?.randomUUID?.() ?? `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const VOICE_OWNER_KEY = "sismica.voiceOwner";
const VOICE_OWNER_LEASE_MS = 12_000;
const VOICE_OWNER_HEARTBEAT_MS = 4_000;
type VoiceOwnerLease = { tabId: string; expiresAt: number };
type VoiceLeaseWindow = Window & {
  __sismicaVoiceLeaseRuntime?: { tabId: string; intervalId: number; cleanup?: () => void };
};
const voiceLeaseWindow = typeof window === "undefined" ? null : (window as VoiceLeaseWindow);
const VOICE_TAB_ID =
  voiceLeaseWindow?.__sismicaVoiceLeaseRuntime?.tabId ??
  globalThis.crypto?.randomUUID?.() ??
  `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let ownsVoiceLease = false;
let ownsRemoteVoiceLease = false;

function emitVoiceTelemetry(
  kind: string,
  details: Omit<Parameters<typeof reportVoiceTelemetry>[0], "clientId" | "kind"> = {}
): void {
  reportVoiceTelemetry({ clientId: VOICE_TELEMETRY_CLIENT_ID, kind, ...details });
}

function recordBlobReadyMetrics(
  metrics: NeuralBlobReadyMetrics,
  details: { eventId?: string; hostId?: BroadcastVoiceHostId }
): void {
  rememberBlobReadyTiming(metrics);
  emitVoiceTelemetry("neural_blob_ready", {
    eventId: details.eventId,
    hostId: details.hostId,
    engine: metrics.engine,
    voice: metrics.voice,
    cacheState: metrics.cacheState,
    wordCount: metrics.wordCount,
    wordBucket: blobReadyWordBucket(metrics.wordCount),
    durationMs: metrics.durationMs
  });
}

function markActiveEventNarrationPlayback(eventId: string, engine: NeuralEngine, seq: number): void {
  activeEventNarrationPlayback = { eventId, engine, seq };
}

function clearActiveEventNarrationPlayback(seq: number): void {
  if (activeEventNarrationPlayback?.seq === seq) {
    activeEventNarrationPlayback = null;
  }
}

export function getActiveEventNarrationPlayback(): ActiveEventNarrationPlayback | null {
  if (!activeEventNarrationPlayback) return null;
  const playback = getNeuralPlaybackState();
  if (!playback) return null;
  return {
    eventId: activeEventNarrationPlayback.eventId,
    engine: activeEventNarrationPlayback.engine,
    currentTimeMs: playback.currentTimeMs,
    durationMs: playback.durationMs,
    playbackRate: playback.playbackRate
  };
}

function readVoiceLease(): VoiceOwnerLease | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(VOICE_OWNER_KEY) ?? "null"
    ) as Partial<VoiceOwnerLease> | null;
    if (!parsed || typeof parsed.tabId !== "string" || typeof parsed.expiresAt !== "number") return null;
    return { tabId: parsed.tabId, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function writeVoiceLease(expiresAt: number): boolean {
  try {
    localStorage.setItem(VOICE_OWNER_KEY, JSON.stringify({ tabId: VOICE_TAB_ID, expiresAt }));
    const verified = readVoiceLease();
    ownsVoiceLease = verified?.tabId === VOICE_TAB_ID;
    return ownsVoiceLease;
  } catch {
    ownsVoiceLease = true;
    return true;
  }
}

function claimVoiceLease(): boolean {
  if (!voiceLeaseWindow) return true;
  if (document.visibilityState === "hidden") {
    ownsVoiceLease = false;
    return false;
  }
  const now = Date.now();
  const lease = readVoiceLease();
  if (lease?.tabId === VOICE_TAB_ID) return writeVoiceLease(now + VOICE_OWNER_LEASE_MS);
  if (lease && lease.expiresAt > now) {
    ownsVoiceLease = false;
    return false;
  }
  return writeVoiceLease(now + VOICE_OWNER_LEASE_MS);
}

async function claimRemoteVoiceLease(): Promise<void> {
  if (!ownsVoiceLease) {
    ownsRemoteVoiceLease = false;
    return;
  }
  ownsRemoteVoiceLease = await claimVoiceOutput(VOICE_TELEMETRY_CLIENT_ID);
}

function releaseVoiceLease(): void {
  if (!voiceLeaseWindow) return;
  let ownsStoredLease = false;
  try {
    ownsStoredLease = readVoiceLease()?.tabId === VOICE_TAB_ID;
    if (ownsStoredLease) localStorage.removeItem(VOICE_OWNER_KEY);
  } catch {
    // localStorage no disponible: la concesion vive solo en esta pestana.
  }
  ownsVoiceLease = false;
  if (ownsRemoteVoiceLease || ownsStoredLease) releaseVoiceOutput(VOICE_TELEMETRY_CLIENT_ID);
  ownsRemoteVoiceLease = false;
}

function isVoiceOutputOwner(): boolean {
  return claimVoiceLease() && ownsRemoteVoiceLease;
}

if (voiceLeaseWindow) {
  const previousRuntime = voiceLeaseWindow.__sismicaVoiceLeaseRuntime;
  if (previousRuntime) {
    window.clearInterval(previousRuntime.intervalId);
    previousRuntime.cleanup?.();
  }
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      releaseVoiceLease();
      return;
    }
    if (voiceEnabled && claimVoiceLease()) void claimRemoteVoiceLease();
  };
  const handlePageHide = () => releaseVoiceLease();
  const intervalId = window.setInterval(() => {
    if (document.visibilityState === "hidden") {
      releaseVoiceLease();
      return;
    }
    if (voiceEnabled && claimVoiceLease()) void claimRemoteVoiceLease();
  }, VOICE_OWNER_HEARTBEAT_MS);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide);
  voiceLeaseWindow.__sismicaVoiceLeaseRuntime = {
    tabId: VOICE_TAB_ID,
    intervalId,
    cleanup: () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    }
  };
}

function canonicalizeEditorialText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function extractMeaningfulTerms(value: string): string[] {
  return canonicalizeEditorialText(value)
    .split(" ")
    .filter((term) => term.length >= 3)
    .filter((term) => !LOCATION_NOISE_TERMS.has(term))
    .filter((term) => !/^\d+$/u.test(term));
}

function sharesLocationTerms(text: string, place: string, country?: string | null): boolean {
  const textTerms = new Set(extractMeaningfulTerms(text));
  if (textTerms.size === 0) return false;

  const placeTerms = Array.from(
    new Set([...extractMeaningfulTerms(place), ...extractMeaningfulTerms(country ?? "")])
  );
  if (placeTerms.length === 0) return false;

  const overlap = placeTerms.filter((term) => textTerms.has(term));
  if (overlap.length >= Math.min(2, placeTerms.length)) return true;
  return overlap.some((term) => term.length >= 6);
}

function introMentionsLocation(intro: string, place: string, country?: string | null): boolean {
  return sharesLocationTerms(intro, place, country);
}

function stableTextHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function pickBreakingNarrationIntro(event: Pick<SeismicEvent, "eventId">): string {
  const index = stableTextHash(event.eventId) % BREAKING_LIVE_INTROS.length;
  return BREAKING_LIVE_INTROS[index] ?? BREAKING_LIVE_INTROS[0];
}

function beginVoiceSession(): () => void {
  activeVoiceSessionCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeVoiceSessionCount = Math.max(0, activeVoiceSessionCount - 1);
  };
}

function pickEditorialIntro(
  requestedIntro: string | undefined,
  editorialIntro: string,
  place: string,
  country: string | null,
  mode: NarrationMode
): string {
  if (requestedIntro?.trim()) return requestedIntro.trim();
  const normalized = editorialIntro.trim();
  if (
    !normalized ||
    containsUnsupportedEditorialText(normalized) ||
    !allowedEditorialIntros(mode).has(canonicalizeEditorialText(normalized))
  ) {
    return fallbackNarrationEditorial(mode).intro;
  }
  if (introMentionsLocation(normalized, place, country)) {
    return fallbackNarrationEditorial(mode).intro;
  }
  return normalized;
}

function containsUnsupportedEditorialText(value: string): boolean {
  return UNSUPPORTED_EDITORIAL_CLAIM_PATTERN.test(canonicalizeEditorialText(value));
}

function containsBridgeKeyword(text: string, keywords: readonly string[]): boolean {
  const normalized = canonicalizeEditorialText(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

export function classifyBridgeGroup(event: SeismicEvent): string {
  const place = canonicalizeEditorialText(broadcastPlace(event));
  const country = canonicalizeEditorialText(broadcastCountryName(countryCode(event)) ?? "");
  const combined = `${place} ${country}`.trim();
  const depth = event.depthKm ?? null;
  const shallow = typeof depth === "number" && depth <= 70;
  const intermediate = typeof depth === "number" && depth > 70 && depth <= 300;
  const deep = typeof depth === "number" && depth > 300;

  if (containsBridgeKeyword(combined, SUBDUCTION_BRIDGE_KEYWORDS)) {
    if (deep) return "subduccion_pacifico_profundo";
    if (intermediate) return "subduccion_pacifico_intermedio";
    return "subduccion_pacifico_superficial";
  }
  if (containsBridgeKeyword(combined, COLLISION_BRIDGE_KEYWORDS)) {
    return "colision_mediterraneo_asiatica";
  }
  if (containsBridgeKeyword(combined, CONTINENTAL_BRIDGE_KEYWORDS) && shallow) {
    return "continental_superficial";
  }
  if (OFFSHORE_BRIDGE_PATTERN.test(broadcastPlace(event)) && shallow) {
    return "marino_superficial";
  }
  if (deep) return "foco_profundo_generico";
  if (intermediate) return "foco_intermedio_generico";
  if (shallow) return "superficial_generico";
  return BRIDGE_FALLBACK_GROUP;
}

function narrationCacheKey(
  event: SeismicEvent,
  options: { intro?: string; closing?: string | null; mode?: NarrationMode } = {}
): string {
  const eventVersion = [
    event.updatedAtUtc ?? event.eventTimeUtc,
    event.title,
    event.magnitude ?? "",
    event.depthKm ?? "",
    event.latitude,
    event.longitude
  ].join("|");
  const mode = options.mode ?? (options.intro ? "breaking" : "seguimiento");
  const intro = options.intro?.trim() ?? "";
  const closing =
    options.closing === undefined
      ? "__editorial__"
      : options.closing === null
        ? "__none__"
        : options.closing.trim();
  return [event.eventId, eventVersion, mode, intro, closing].join("|");
}

function rememberNarrationPacket(key: string, packet: ResolvedNarrationPacket): void {
  narrationCache.delete(key);
  narrationCache.set(key, packet);
  while (narrationCache.size > NARRATION_CACHE_LIMIT) {
    const oldest = narrationCache.keys().next().value;
    if (oldest === undefined) break;
    narrationCache.delete(oldest);
  }
}

function loadEngine(): VoiceEngine {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "chatterbox" || stored === "piper" || stored === "xtts" || stored === "browser") {
      engineExplicit = true;
      return stored;
    }
  } catch {
    // localStorage no disponible: usa el respaldo.
  }
  return "browser";
}

function bestAvailableVoiceEngine(): VoiceEngine {
  const loaded = NEURAL_PRIORITY.find(
    (engine) =>
      healthSnapshot?.enabled && healthSnapshot.engines[engine]?.ok && healthSnapshot.engines[engine]?.loaded
  );
  if (loaded) return loaded;
  const preferred = NEURAL_PRIORITY.find(
    (engine) => healthSnapshot?.enabled && healthSnapshot.engines[engine]?.ok
  );
  if (preferred) return preferred;
  return isBrowserVoiceSupported() ? "browser" : "piper";
}

// --- Selector de motor ---

export function getVoiceEngine(): VoiceEngine {
  return voiceEngine;
}

export function setVoiceEngine(engine: VoiceEngine): void {
  voiceEngine = engine;
  engineExplicit = true;
  try {
    localStorage.setItem(STORAGE_KEY, engine);
  } catch {
    // Persistencia best-effort.
  }
  // Al cambiar de motor, corta cualquier narracion neural en curso.
  cancelNeuralNarration();
}

export async function activateVoiceEngine(engine: VoiceEngine, signal?: AbortSignal): Promise<void> {
  cancelNeuralNarration();
  healthSnapshot = await activateTtsEngine(engine, signal);
  setVoiceEngine(engine);
}

export function getTtsHealthSnapshot(): TtsHealth | null {
  return healthSnapshot;
}

function findBroadcastHost(id: BroadcastVoiceHostId): BroadcastVoiceHost {
  return BROADCAST_VOICE_HOSTS.find((host) => host.id === id) ?? BROADCAST_VOICE_HOSTS[0];
}

function neuralProfilesForEngine(engine: NeuralEngine): string[] {
  return healthSnapshot?.engines[engine]?.profiles ?? [];
}

function isGuideLibrary(library: SeismicBridgeLibrary): boolean {
  return (
    library === INFORMATIVE_GUIDE_LIBRARY ||
    library === EDUCATIONAL_GUIDE_LIBRARY ||
    library === OFFICIAL_INFORMATIVE_GUIDE_LIBRARY ||
    library === OFFICIAL_EDUCATIONAL_GUIDE_LIBRARY ||
    library === OFFICIAL_PROMOTIONAL_GUIDE_LIBRARY
  );
}

async function loadBridgeManifest(library: SeismicBridgeLibrary): Promise<SeismicBridgeManifest | null> {
  const cached = bridgeManifestCache.get(library);
  if (cached) return cached;
  const pending = fetchSeismicBridgeManifest(library).catch(() => null);
  bridgeManifestCache.set(library, pending);
  return pending;
}

function bridgeCandidateKey(item: Pick<SeismicBridgeManifestItem, "voice" | "groupId" | "variant">): string {
  return `${item.voice}|${item.groupId}|${item.variant}`;
}

function bridgeCandidateSignature(candidates: readonly SeismicBridgeManifestItem[]): string {
  return candidates.map(bridgeCandidateKey).sort().join("||");
}

function shuffleBridgeKeys(keys: readonly string[]): string[] {
  const shuffled = [...keys];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function foldBridgeText(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ");
}

function scoreBridgeCandidate(item: SeismicBridgeManifestItem, foldedContext: string): number {
  if (item.keywords.length === 0 || !foldedContext) return 0;
  let score = 0;
  for (const keyword of item.keywords) {
    const foldedKeyword = foldBridgeText(keyword).trim();
    if (foldedKeyword && foldedContext.includes(foldedKeyword)) score += 1;
  }
  return score;
}

function narrowBridgeCandidates(
  candidates: readonly SeismicBridgeManifestItem[],
  contextText?: string
): readonly SeismicBridgeManifestItem[] {
  if (!contextText) return candidates;
  const foldedContext = foldBridgeText(contextText).trim();
  if (!foldedContext) return candidates;

  let bestScore = 0;
  const scored = candidates.map((item) => {
    const score = scoreBridgeCandidate(item, foldedContext);
    if (score > bestScore) bestScore = score;
    return { item, score };
  });
  if (bestScore <= 0) return candidates;
  return scored.filter((candidate) => candidate.score === bestScore).map((candidate) => candidate.item);
}

function recentBridgeHistoryKey(manifest: SeismicBridgeManifest, voice: string): string | null {
  return isGuideLibrary(manifest.library) ? `${manifest.library}|${voice}|recent` : null;
}

function excludeRecentBridgeCandidates(
  poolKey: string | null,
  candidates: readonly SeismicBridgeManifestItem[],
  limit: number
): readonly SeismicBridgeManifestItem[] {
  if (!poolKey || limit <= 0 || candidates.length <= 1) return [];
  const recentKeys = recentBridgeCandidateKeysByPool.get(poolKey) ?? [];
  if (recentKeys.length === 0) return [];
  return candidates.filter((item) => !recentKeys.includes(bridgeCandidateKey(item)));
}

function rememberRecentBridgeCandidate(
  poolKey: string | null,
  item: SeismicBridgeManifestItem,
  limit: number
): void {
  if (!poolKey || limit <= 0) return;
  const key = bridgeCandidateKey(item);
  const recentKeys = [
    key,
    ...(recentBridgeCandidateKeysByPool.get(poolKey) ?? []).filter((entry) => entry !== key)
  ];
  recentBridgeCandidateKeysByPool.set(poolKey, recentKeys.slice(0, limit));
}

function refillBridgeCycle(poolKey: string, candidates: readonly SeismicBridgeManifestItem[]): string[] {
  const previousKey = lastBridgeCandidateKeyByPool.get(poolKey);
  const keys = shuffleBridgeKeys(candidates.map(bridgeCandidateKey));
  if (previousKey && keys.length > 1 && keys[0] === previousKey) {
    const nextIndex = keys.findIndex((key) => key !== previousKey);
    if (nextIndex > 0) {
      [keys[0], keys[nextIndex]] = [keys[nextIndex], keys[0]];
    }
  }
  bridgeCycleByPool.set(poolKey, {
    signature: bridgeCandidateSignature(candidates),
    remainingKeys: keys
  });
  return keys;
}

function drawBridgeCandidate(
  poolKey: string,
  candidates: readonly SeismicBridgeManifestItem[],
  options: {
    recentHistoryKey?: string | null;
    recentHistoryLimit?: number;
    allowRepeatWhenExhausted?: boolean;
  } = {}
): SeismicBridgeManifestItem | null {
  if (candidates.length === 0) return null;
  const now = Date.now();
  const library = poolKey.split("|", 1)[0] ?? "bridge";
  const selectionKey = (item: SeismicBridgeManifestItem) => `${library}|${bridgeCandidateKey(item)}`;
  const hourlyEligible = candidates.filter(
    (item) => now - (bridgeCandidateSelectedAt.get(selectionKey(item)) ?? 0) >= BRIDGE_CLIP_REPEAT_WINDOW_MS
  );
  if (hourlyEligible.length === 0 && !options.allowRepeatWhenExhausted) return null;
  const repeatEligible = hourlyEligible.length > 0 ? hourlyEligible : candidates;
  const filteredCandidates = excludeRecentBridgeCandidates(
    options.recentHistoryKey ?? null,
    repeatEligible,
    options.recentHistoryLimit ?? 0
  );
  const activeCandidates = filteredCandidates.length > 0 ? filteredCandidates : repeatEligible;

  const signature = bridgeCandidateSignature(activeCandidates);
  const currentCycle = bridgeCycleByPool.get(poolKey);
  let remainingKeys =
    currentCycle?.signature === signature
      ? currentCycle.remainingKeys.filter((key) =>
          activeCandidates.some((item) => bridgeCandidateKey(item) === key)
        )
      : [];

  if (remainingKeys.length === 0) {
    remainingKeys = refillBridgeCycle(poolKey, activeCandidates);
  }

  const selectedKey = remainingKeys.shift();
  bridgeCycleByPool.set(poolKey, { signature, remainingKeys });

  const selected =
    activeCandidates.find((item) => bridgeCandidateKey(item) === selectedKey) ?? activeCandidates[0] ?? null;
  if (!selected) return null;
  lastBridgeCandidateKeyByPool.set(poolKey, bridgeCandidateKey(selected));
  bridgeCandidateSelectedAt.set(selectionKey(selected), now);
  rememberRecentBridgeCandidate(options.recentHistoryKey ?? null, selected, options.recentHistoryLimit ?? 0);
  return selected;
}

function pickBridgeCandidate(
  manifest: SeismicBridgeManifest,
  voice: string,
  groupId: string,
  contextText?: string,
  strictGroup = false,
  allowRepeatWhenExhausted = false
): SeismicBridgeManifestItem | null {
  const recentHistoryKey = recentBridgeHistoryKey(manifest, voice);
  const recentHistoryLimit = isGuideLibrary(manifest.library) ? GUIDE_RECENT_HISTORY_LIMIT : 0;
  const pools = [
    {
      id: `group:${groupId}`,
      candidates: manifest.items.filter((item) => item.voice === voice && item.groupId === groupId)
    }
  ];
  if (!strictGroup) {
    pools.push(
      {
        id: `group:${BRIDGE_FALLBACK_GROUP}`,
        candidates: manifest.items.filter(
          (item) => item.voice === voice && item.groupId === BRIDGE_FALLBACK_GROUP
        )
      },
      {
        id: "voice:any",
        candidates: manifest.items.filter((item) => item.voice === voice)
      }
    );
  }

  for (const pool of pools) {
    const narrowedCandidates = narrowBridgeCandidates(pool.candidates, contextText);
    let candidates = narrowedCandidates;
    if (recentHistoryKey && narrowedCandidates !== pool.candidates) {
      const diversifiedCandidates = excludeRecentBridgeCandidates(
        recentHistoryKey,
        narrowedCandidates,
        recentHistoryLimit
      );
      if (diversifiedCandidates.length === 0) {
        const fallbackCandidates = excludeRecentBridgeCandidates(
          recentHistoryKey,
          pool.candidates,
          recentHistoryLimit
        );
        if (fallbackCandidates.length > 0) candidates = fallbackCandidates;
      }
    }
    if (candidates.length === 0) continue;
    const poolKey = `${manifest.library}|${voice}|${pool.id}`;
    const selected = drawBridgeCandidate(poolKey, candidates, {
      recentHistoryKey,
      recentHistoryLimit,
      allowRepeatWhenExhausted
    });
    if (!selected) continue;
    return selected;
  }

  return null;
}

function drawGuideVoice(voices: readonly string[]): string | null {
  const uniqueVoices = [...new Set(voices)].sort((left, right) => left.localeCompare(right));
  if (uniqueVoices.length === 0) return null;
  const signature = uniqueVoices.join("|");

  let remainingVoices = guideVoiceCycleBySignature.get(signature) ?? [];
  if (remainingVoices.length === 0) {
    remainingVoices = shuffleBridgeKeys(uniqueVoices);
    const lastGuideVoice = lastGuideVoiceBySignature.get(signature);
    if (lastGuideVoice && remainingVoices.length > 1 && remainingVoices[0] === lastGuideVoice) {
      const nextIndex = remainingVoices.findIndex((voice) => voice !== lastGuideVoice);
      [remainingVoices[0], remainingVoices[nextIndex]] = [remainingVoices[nextIndex], remainingVoices[0]];
    }
  }

  const voice = remainingVoices.shift() ?? null;
  guideVoiceCycleBySignature.set(signature, remainingVoices);
  if (voice) lastGuideVoiceBySignature.set(signature, voice);
  return voice;
}

function pickGuideBridgeCandidate(
  manifest: SeismicBridgeManifest,
  groupId: string,
  contextText?: string,
  constraints: {
    minDurationMs?: number;
    maxDurationMs?: number;
    requireApproved?: boolean;
    directorV2Eligible?: boolean;
    directorV2TransitionEligible?: boolean;
    strictGroup?: boolean;
    allowRepeatWhenExhausted?: boolean;
  } = {}
): SeismicBridgeManifestItem | null {
  const constrainedItems = manifest.items.filter((item) => {
    if (constraints.requireApproved && item.approvalStatus !== "approved") return false;
    if (constraints.directorV2TransitionEligible) {
      return isDirectorV2TransitionClipEligible({
        durationMs: item.durationMs,
        classId: item.classId,
        playbackRole: item.playbackRole
      });
    }
    if (constraints.directorV2Eligible) {
      return isDirectorV2GuideClipEligible({
        durationMs: item.durationMs,
        classId: item.classId,
        playbackRole: item.playbackRole
      });
    }
    if (
      constraints.minDurationMs !== undefined &&
      (item.durationMs === null || item.durationMs < constraints.minDurationMs)
    ) {
      return false;
    }
    if (
      constraints.maxDurationMs !== undefined &&
      (item.durationMs === null || item.durationMs > constraints.maxDurationMs)
    ) {
      return false;
    }
    return true;
  });
  const constrainedManifest =
    constrainedItems.length === manifest.items.length ? manifest : { ...manifest, items: constrainedItems };
  const voices = constrainedManifest.items.map((item) => item.voice);
  const uniqueVoiceCount = new Set(voices).size;
  const attemptedVoices = new Set<string>();
  let draws = 0;

  while (attemptedVoices.size < uniqueVoiceCount && draws < uniqueVoiceCount * 2) {
    const voice = drawGuideVoice(voices);
    if (!voice) return null;
    draws += 1;
    if (attemptedVoices.has(voice)) continue;
    attemptedVoices.add(voice);
    const selected = pickBridgeCandidate(
      constrainedManifest,
      voice,
      groupId,
      contextText,
      constraints.strictGroup,
      constraints.allowRepeatWhenExhausted
    );
    if (selected) return selected;
  }

  return null;
}

async function selectBridgeClip(
  library: SeismicBridgeLibrary,
  voice: string,
  groupId: string,
  allowAnyVoice = false,
  contextText?: string,
  constraints: {
    minDurationMs?: number;
    maxDurationMs?: number;
    requireApproved?: boolean;
    directorV2Eligible?: boolean;
    directorV2TransitionEligible?: boolean;
    strictGroup?: boolean;
    allowRepeatWhenExhausted?: boolean;
  } = {}
): Promise<SeismicBridgeManifestItem | null> {
  const manifest = await loadBridgeManifest(library);
  if (!manifest) return null;
  const selected = isGuideLibrary(manifest.library)
    ? pickGuideBridgeCandidate(manifest, groupId, contextText, constraints)
    : pickBridgeCandidate(manifest, voice, groupId, contextText);
  if (selected || !allowAnyVoice) return selected;

  const candidates = narrowBridgeCandidates(
    manifest.items.filter((item) => item.groupId === groupId),
    contextText
  );
  if (candidates.length === 0) return null;
  const poolKey = `${manifest.library}|all|${groupId}`;
  return drawBridgeCandidate(poolKey, candidates);
}

export function resetBridgeSelectionStateForTests(): void {
  lastBridgeCandidateKeyByPool.clear();
  bridgeCycleByPool.clear();
  recentBridgeCandidateKeysByPool.clear();
  bridgeCandidateSelectedAt.clear();
  guideVoiceCycleBySignature.clear();
  lastGuideVoiceBySignature.clear();
  directorV2GuideClassCursor = 0;
  directorV2PlayedGuideCount = 0;
  directorV2PromotionalGuideCount = 0;
}

export function pickBridgeCandidateForTests(
  manifest: SeismicBridgeManifest,
  voice: string,
  groupId: string,
  contextText?: string
): SeismicBridgeManifestItem | null {
  return pickBridgeCandidate(manifest, voice, groupId, contextText);
}

export function pickGuideBridgeCandidateForTests(
  manifest: SeismicBridgeManifest,
  groupId: string,
  contextText?: string,
  constraints: {
    minDurationMs?: number;
    maxDurationMs?: number;
    requireApproved?: boolean;
    directorV2Eligible?: boolean;
    directorV2TransitionEligible?: boolean;
    strictGroup?: boolean;
    allowRepeatWhenExhausted?: boolean;
  } = {}
): SeismicBridgeManifestItem | null {
  return pickGuideBridgeCandidate(manifest, groupId, contextText, constraints);
}

export function pickDirectorV2TransitionCandidateForTests(
  manifest: SeismicBridgeManifest
): SeismicBridgeManifestItem | null {
  return pickGuideBridgeCandidate(manifest, "continuity_transition", undefined, {
    requireApproved: true,
    directorV2TransitionEligible: true,
    strictGroup: true,
    allowRepeatWhenExhausted: true
  });
}

type BridgePlaybackPlan = {
  libraries: SeismicBridgeLibrary[];
  maxBridgeElapsedMs: number;
};

const blobReadySamplesByKey = new Map<string, number[]>();

function spokenWordCount(value: string): number {
  return canonicalizeEditorialText(value)
    .split(" ")
    .filter((term) => term.length > 0).length;
}

function blobReadyWordBucket(wordCount: number): string {
  if (wordCount <= BRIDGE_SHORT_ONLY_MAX_WORDS) return "00-18";
  if (wordCount <= BRIDGE_SINGLE_EXTENDED_MAX_WORDS) return "19-30";
  if (wordCount <= BRIDGE_DOUBLE_EXTENDED_MAX_WORDS) return "31-48";
  if (wordCount < GUIDE_LONG_TEXT_MIN_WORDS) return "49-63";
  if (wordCount <= 80) return "64-80";
  return "81+";
}

function blobReadySampleKey(engine: NeuralEngine, voice: string, wordBucket: string): string {
  return `${engine}|${voice}|${wordBucket}`;
}

function appendBlobReadySample(key: string, durationMs: number): void {
  const samples = blobReadySamplesByKey.get(key) ?? [];
  samples.push(Math.max(0, Math.round(durationMs)));
  while (samples.length > BLOB_READY_SAMPLE_LIMIT) {
    samples.shift();
  }
  blobReadySamplesByKey.set(key, samples);
}

function sampleQuantileMs(samples: readonly number[], quantile: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile)));
  return sorted[index] ?? null;
}

function rememberBlobReadyTiming(metrics: NeuralBlobReadyMetrics): void {
  if (metrics.cacheState === "ready" || metrics.wordCount <= 0) return;
  const wordBucket = blobReadyWordBucket(metrics.wordCount);
  appendBlobReadySample(
    blobReadySampleKey(metrics.engine, metrics.voice ?? "default", wordBucket),
    metrics.durationMs
  );
  appendBlobReadySample(blobReadySampleKey(metrics.engine, "all", wordBucket), metrics.durationMs);
}

function estimateBlobReadyMs(
  engine: NeuralEngine,
  voice: string | undefined,
  wordCount: number
): number | null {
  const wordBucket = blobReadyWordBucket(wordCount);
  const voiceSamples =
    blobReadySamplesByKey.get(blobReadySampleKey(engine, voice ?? "default", wordBucket)) ?? [];
  if (voiceSamples.length >= BLOB_READY_VOICE_MIN_SAMPLES) {
    return sampleQuantileMs(voiceSamples, 0.75);
  }
  const bucketSamples = blobReadySamplesByKey.get(blobReadySampleKey(engine, "all", wordBucket)) ?? [];
  if (bucketSamples.length >= BLOB_READY_BUCKET_MIN_SAMPLES) {
    return sampleQuantileMs(bucketSamples, 0.75);
  }
  return null;
}

function baseBridgeBudgetMs(wordCount: number): number {
  if (wordCount <= BRIDGE_SHORT_ONLY_MAX_WORDS) return BRIDGE_MAX_ELAPSED_SHORT_TEXT_MS;
  if (wordCount <= BRIDGE_SINGLE_EXTENDED_MAX_WORDS) return BRIDGE_MAX_ELAPSED_MEDIUM_TEXT_MS;
  if (wordCount <= BRIDGE_DOUBLE_EXTENDED_MAX_WORDS) return BRIDGE_MAX_ELAPSED_LONG_TEXT_MS;
  if (wordCount < GUIDE_LONG_TEXT_MIN_WORDS) return BRIDGE_MAX_ELAPSED_STATION_TEXT_MS;
  return BRIDGE_MAX_ELAPSED_DOUBLE_STATION_TEXT_MS;
}

function minimumBridgeBudgetMs(wordCount: number): number {
  if (wordCount <= BRIDGE_SHORT_ONLY_MAX_WORDS) return BRIDGE_MIN_ELAPSED_SHORT_TEXT_MS;
  if (wordCount <= BRIDGE_SINGLE_EXTENDED_MAX_WORDS) return BRIDGE_MIN_ELAPSED_MEDIUM_TEXT_MS;
  if (wordCount <= BRIDGE_DOUBLE_EXTENDED_MAX_WORDS) return BRIDGE_MIN_ELAPSED_LONG_TEXT_MS;
  if (wordCount < GUIDE_LONG_TEXT_MIN_WORDS) return BRIDGE_MIN_ELAPSED_STATION_TEXT_MS;
  return BRIDGE_MIN_ELAPSED_DOUBLE_STATION_TEXT_MS;
}

function adaptiveBridgeBudgetMs(wordCount: number, engine: NeuralEngine, voice?: string): number {
  const hardCapMs = baseBridgeBudgetMs(wordCount);
  const estimatedBlobReadyMs = estimateBlobReadyMs(engine, voice, wordCount);
  // Sin muestras reales: nos quedamos con el hardcap conservador por nº de palabras.
  if (estimatedBlobReadyMs === null) return hardCapMs;

  // Con muestras de neural_blob_ready el presupuesto sigue la latencia OBSERVADA (p75 + slack)
  // en vez del hardcap fijo. Asi los puentes cubren generaciones lentas (~50-55 s) que antes
  // dejaban aire muerto de cola justo antes de la voz. El techo absoluto evita rellenar sin fin
  // si la generacion nunca completa.
  const slackMs = wordCount < GUIDE_LONG_TEXT_MIN_WORDS ? 2_500 : 4_000;
  const upperBoundMs = Math.max(hardCapMs, BRIDGE_ADAPTIVE_BUDGET_CEILING_MS);
  return Math.max(
    minimumBridgeBudgetMs(wordCount),
    Math.min(upperBoundMs, Math.round(estimatedBlobReadyMs + slackMs))
  );
}

function orderedGuideLibraries(wordCount: number): SeismicBridgeLibrary[] {
  return wordCount >= GUIDE_LONG_TEXT_MIN_WORDS
    ? [INFORMATIVE_GUIDE_LIBRARY, EDUCATIONAL_GUIDE_LIBRARY]
    : [EDUCATIONAL_GUIDE_LIBRARY, INFORMATIVE_GUIDE_LIBRARY];
}

function orderedDirectorV2GuideLibraries(wordCount: number): SeismicBridgeLibrary[] {
  if (DIRECTOR_V2_GUIDE_SET === "official") {
    return [OFFICIAL_INFORMATIVE_GUIDE_LIBRARY, OFFICIAL_PROMOTIONAL_GUIDE_LIBRARY];
  }
  const informative = INFORMATIVE_GUIDE_LIBRARY;
  const educational = EDUCATIONAL_GUIDE_LIBRARY;
  return wordCount >= GUIDE_LONG_TEXT_MIN_WORDS ? [informative, educational] : [educational, informative];
}

function drawDirectorV2GuideClass(
  priority: DirectorV2GuidePriority,
  higherPriorityPending: boolean
): DirectorV2GuideClassId {
  const selection = selectDirectorV2GuideClass({
    cursor: directorV2GuideClassCursor,
    priority,
    higherPriorityPending,
    playedGuideCount: directorV2PlayedGuideCount,
    promotionalGuideCount: directorV2PromotionalGuideCount
  });
  directorV2GuideClassCursor = selection.nextCursor;
  return selection.classId;
}

function rememberDirectorV2GuideStarted(classId?: string | null): void {
  if (DIRECTOR_V2_GUIDE_SET !== "official") return;
  directorV2PlayedGuideCount += 1;
  if (classId === "promotional_channel") directorV2PromotionalGuideCount += 1;
}

function canUseDirectorV2PromotionalGuide(
  priority: DirectorV2GuidePriority,
  higherPriorityPending: boolean
): boolean {
  if (DIRECTOR_V2_GUIDE_SET !== "official") return false;
  if (priority !== "routine" || higherPriorityPending) return false;
  const nextGuideCount = directorV2PlayedGuideCount + 1;
  const nextPromotionalCount = directorV2PromotionalGuideCount + 1;
  return nextPromotionalCount * 10 <= nextGuideCount;
}

function buildBridgePlaybackPlan(
  text: string,
  voice?: string,
  engine: NeuralEngine = "chatterbox",
  guideLibrary: SeismicBridgeLibrary | null = null
): BridgePlaybackPlan {
  const words = spokenWordCount(text);
  const guideLibraries = orderedGuideLibraries(words);
  const libraries =
    guideLibrary && isGuideLibrary(guideLibrary)
      ? [guideLibrary, ...guideLibraries.filter((library) => library !== guideLibrary)]
      : guideLibraries;
  return {
    libraries,
    maxBridgeElapsedMs: adaptiveBridgeBudgetMs(words, engine, voice)
  };
}

type BridgeRuntimePlan = BridgePlaybackPlan & {
  continuityMode: VoiceContinuityMode;
  startDelayMs: number;
  interGuideGapMs: number;
  handoffGapMs: number;
  maxGuides: number;
  secondGuideEarliestMs: number;
  requireApproved: boolean;
};

function buildBridgeRuntimePlan(
  text: string,
  voice: string | undefined,
  engine: NeuralEngine,
  continuityMode: VoiceContinuityMode,
  priority: DirectorV2GuidePriority
): BridgeRuntimePlan {
  const legacy = buildBridgePlaybackPlan(text, voice, engine);
  if (continuityMode !== "director-v2") {
    return {
      ...legacy,
      continuityMode,
      startDelayMs: BRIDGE_START_DELAY_MS,
      interGuideGapMs: BRIDGE_INTER_CLIP_GAP_MS,
      handoffGapMs: BRIDGE_DIALOGUE_HANDOFF_GAP_MS,
      maxGuides: Number.POSITIVE_INFINITY,
      secondGuideEarliestMs: 0,
      requireApproved: false
    };
  }

  const policy = buildDirectorV2GuidePlan(priority);
  return {
    libraries: orderedDirectorV2GuideLibraries(spokenWordCount(text)),
    maxBridgeElapsedMs: Number.POSITIVE_INFINITY,
    continuityMode,
    startDelayMs: policy.startDelayMs,
    interGuideGapMs: policy.interGuideGapMs,
    handoffGapMs: policy.handoffGapMs,
    maxGuides: policy.maxGuides,
    secondGuideEarliestMs: policy.secondGuideEarliestMs,
    requireApproved: DIRECTOR_V2_GUIDE_SET === "official"
  };
}

export function buildBridgePlaybackPlanForTests(
  text: string,
  voice?: string,
  engine: NeuralEngine = "chatterbox",
  guideLibrary: SeismicBridgeLibrary | null = null
): BridgePlaybackPlan {
  return buildBridgePlaybackPlan(text, voice, engine, guideLibrary);
}

export function resetBlobReadyTelemetryForTests(): void {
  blobReadySamplesByKey.clear();
}

export function rememberBlobReadyTimingForTests(metrics: NeuralBlobReadyMetrics): void {
  rememberBlobReadyTiming(metrics);
}

type BridgeHandle = {
  arm(): void;
  stop(mode?: "finish" | "fade" | "immediate"): Promise<void>;
};

let activeBridgeHandle: BridgeHandle | null = null;

function stopActiveBridge(mode: "finish" | "fade" | "immediate" = "fade"): void {
  const bridge = activeBridgeHandle;
  activeBridgeHandle = null;
  if (bridge) void bridge.stop(mode);
}

async function finishActiveBridgePlayback(): Promise<void> {
  const bridge = activeBridgeHandle;
  if (!bridge) return;
  await bridge.stop("finish");
  if (activeBridgeHandle === bridge) {
    activeBridgeHandle = null;
  }
}

function createBridgeHandle(options: {
  engine: NeuralEngine;
  text: string;
  eventId?: string;
  hostId?: BroadcastVoiceHostId;
  speaker?: string;
  groupId: string;
  allowGuide?: boolean;
  continuityMode?: VoiceContinuityMode;
  priority?: DirectorV2GuidePriority;
  isHigherPriorityPending?: () => boolean;
}): BridgeHandle {
  if (options.engine !== "chatterbox") {
    return {
      arm() {
        // Sin puentes pregabados fuera de Chatterbox.
      },
      async stop() {
        // Nada que cerrar.
      }
    };
  }

  if (options.allowGuide === false) {
    return {
      arm() {
        // Sin pautas de espera para esta locucion.
      },
      async stop() {
        // Nada que cerrar.
      }
    };
  }

  const neuralVoice = resolveNeuralSpeaker(options.engine, options.hostId, options.speaker);
  let audio: HTMLAudioElement | null = null;
  let activeClip: SeismicBridgeManifestItem | null = null;
  let activeLibrary: SeismicBridgeLibrary | null = null;
  let activeClipStartedAt: number | null = null;
  let lastClipEndedAt: number | null = null;
  const bridgePlan = buildBridgeRuntimePlan(
    options.text,
    neuralVoice,
    options.engine,
    options.continuityMode ?? "legacy",
    options.priority ?? "routine"
  );
  const libraries = bridgePlan.libraries;
  let nextLibraryIndex = 0;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let naturalCompletionResolve: (() => void) | null = null;
  let naturalCompletionTimer: number | null = null;
  let startupResolved = false;
  let resolveStartup: (() => void) | null = null;
  let playedClipCount = 0;
  const startupPromise = new Promise<void>((resolve) => {
    resolveStartup = resolve;
  });
  const timers: number[] = [];
  let bridgeArmedAt: number | null = null;
  let bridgeBudgetLogged = false;
  let transitionClipPlayed = false;

  const settleStartup = () => {
    if (startupResolved) return;
    startupResolved = true;
    resolveStartup?.();
    resolveStartup = null;
  };

  const clearTimers = () => {
    while (timers.length > 0) {
      window.clearTimeout(timers.pop());
    }
  };

  const currentBlobState = () =>
    getNeuralBlobState(options.text, options.engine, {
      voice: neuralVoice
    });

  const waitBridgeGap = (delayMs: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs);
    });

  const waitHandoffGap = async () => {
    if (lastClipEndedAt === null) return;
    const remainingGapMs = Math.max(0, bridgePlan.handoffGapMs - (performance.now() - lastClipEndedAt));
    if (remainingGapMs > 0) await waitBridgeGap(remainingGapMs);
  };

  const scheduleNextLibrary = (delayMs: number) => {
    timers.push(
      window.setTimeout(() => {
        void playNextLibrary();
      }, delayMs)
    );
  };

  const bridgeElapsedMs = () => (bridgeArmedAt === null ? 0 : performance.now() - bridgeArmedAt);

  const bridgeBudgetReached = () =>
    bridgeArmedAt !== null && bridgeElapsedMs() >= bridgePlan.maxBridgeElapsedMs;

  const logBridgeBudgetReached = () => {
    if (bridgeBudgetLogged || !bridgeBudgetReached()) return;
    bridgeBudgetLogged = true;
    emitVoiceTelemetry("bridge_budget_reached", {
      eventId: options.eventId,
      hostId: options.hostId,
      requestedGroupId: options.groupId,
      outcome: bridgePlan.continuityMode,
      durationMs: bridgeElapsedMs()
    });
  };

  const detachAudio = (
    candidate: HTMLAudioElement | null = audio,
    reason: "ended" | "error" | "fade" | "immediate" | "timeout" = "immediate"
  ) => {
    if (!candidate) return;
    if (audio === candidate) {
      audio = null;
      activeBridgePlaybackCount = Math.max(0, activeBridgePlaybackCount - 1);
      if (activeClip && activeLibrary) {
        emitVoiceTelemetry("bridge_ended", {
          eventId: options.eventId,
          hostId: options.hostId,
          library: activeLibrary,
          variant: activeClip.variant,
          requestedGroupId: options.groupId,
          selectedGroupId: activeClip.groupId,
          clipText: activeClip.text,
          reason,
          durationMs: activeClipStartedAt === null ? undefined : performance.now() - activeClipStartedAt
        });
      }
      activeClip = null;
      activeLibrary = null;
      activeClipStartedAt = null;
      if (reason === "ended") lastClipEndedAt = performance.now();
      if (naturalCompletionTimer !== null) window.clearTimeout(naturalCompletionTimer);
      naturalCompletionTimer = null;
      naturalCompletionResolve?.();
      naturalCompletionResolve = null;
    }
    candidate.pause();
    candidate.src = "";
  };

  const playTransitionBeforeHandoff = async (): Promise<boolean> => {
    if (
      transitionClipPlayed ||
      bridgePlan.continuityMode !== "director-v2" ||
      DIRECTOR_V2_GUIDE_SET !== "official" ||
      playedClipCount <= 0 ||
      audio
    ) {
      return false;
    }
    transitionClipPlayed = true;
    const clip = await selectBridgeClip(
      OFFICIAL_INFORMATIVE_GUIDE_LIBRARY,
      neuralVoice ?? "",
      "continuity_transition",
      false,
      `${options.text} continuity_transition`,
      {
        requireApproved: true,
        directorV2TransitionEligible: true,
        strictGroup: true,
        allowRepeatWhenExhausted: true
      }
    );
    if (!clip || audio) return false;

    const candidate = new Audio(clip.url);
    candidate.preload = "auto";
    candidate.volume = 1;
    audio = candidate;
    activeClip = clip;
    activeLibrary = OFFICIAL_INFORMATIVE_GUIDE_LIBRARY;
    activeBridgePlaybackCount += 1;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timeout: number | null = null;
      const cleanup = (reason: "ended" | "error" | "timeout") => {
        if (settled) return;
        settled = true;
        if (timeout !== null) window.clearTimeout(timeout);
        candidate.removeEventListener("ended", onEnded);
        candidate.removeEventListener("error", onError);
        detachAudio(candidate, reason);
        resolve(reason === "ended");
      };
      const onEnded = () => cleanup("ended");
      const onError = () => cleanup("error");
      candidate.addEventListener("ended", onEnded, { once: true });
      candidate.addEventListener("error", onError, { once: true });
      timeout = window.setTimeout(
        () => cleanup("timeout"),
        Math.min(BRIDGE_TRANSITION_FINISH_TIMEOUT_MS, (clip.durationMs ?? 5_000) + 2_000)
      );
      void candidate
        .play()
        .then(() => {
          if (audio !== candidate) return;
          activeClipStartedAt = performance.now();
          emitVoiceTelemetry("bridge_started", {
            eventId: options.eventId,
            hostId: options.hostId,
            library: OFFICIAL_INFORMATIVE_GUIDE_LIBRARY,
            voice: clip.voice,
            variant: clip.variant,
            requestedGroupId: "continuity_transition",
            selectedGroupId: clip.groupId,
            clipText: clip.text,
            durationMs: clip.durationMs ?? undefined,
            outcome: "director-v2-transition"
          });
        })
        .catch(() => cleanup("error"));
    });
  };

  const playLibrary = async (
    library: SeismicBridgeLibrary,
    guideGroupId = TRIAL_GUIDE_GROUP
  ): Promise<boolean> => {
    if (stopped || audio) return false;
    const contextText = `${options.text} ${options.groupId}`;
    const clip = await selectBridgeClip(library, neuralVoice ?? "", guideGroupId, false, contextText, {
      requireApproved: bridgePlan.requireApproved,
      directorV2Eligible: bridgePlan.continuityMode === "director-v2",
      strictGroup: bridgePlan.continuityMode === "director-v2" && DIRECTOR_V2_GUIDE_SET === "official",
      allowRepeatWhenExhausted:
        bridgePlan.continuityMode === "director-v2" && DIRECTOR_V2_GUIDE_SET === "official"
    });
    if (!clip || stopped || audio) {
      if (!clip && bridgePlan.continuityMode === "director-v2") {
        emitVoiceTelemetry("bridge_skipped_ineligible", {
          eventId: options.eventId,
          hostId: options.hostId,
          library,
          requestedGroupId: options.groupId,
          outcome: DIRECTOR_V2_GUIDE_SET
        });
      }
      return false;
    }
    if (
      bridgePlan.continuityMode === "director-v2" &&
      !isDirectorV2GuideClipEligible({
        durationMs: clip.durationMs,
        classId: clip.classId,
        playbackRole: clip.playbackRole
      })
    ) {
      return false;
    }

    const candidate = new Audio(clip.url);
    candidate.preload = "auto";
    candidate.volume = 1;
    audio = candidate;
    settleStartup();
    activeClip = clip;
    activeLibrary = library;
    activeBridgePlaybackCount += 1;

    let settled = false;
    const cleanup = (reason: "ended" | "error") => {
      if (settled) return;
      settled = true;
      candidate.removeEventListener("ended", onEnded);
      candidate.removeEventListener("error", onError);
      detachAudio(candidate, reason);
      const waitForSecondGuideMs =
        bridgePlan.continuityMode === "director-v2" && playedClipCount > 0
          ? Math.max(0, bridgePlan.secondGuideEarliestMs - bridgeElapsedMs())
          : 0;
      scheduleNextLibrary(Math.max(bridgePlan.interGuideGapMs, waitForSecondGuideMs));
    };
    const onEnded = () => cleanup("ended");
    const onError = () => cleanup("error");

    candidate.addEventListener("ended", onEnded, { once: true });
    candidate.addEventListener("error", onError, { once: true });
    void candidate
      .play()
      .then(() => {
        if (audio !== candidate) return;
        playedClipCount += 1;
        activeClipStartedAt = performance.now();
        rememberDirectorV2GuideStarted(clip.classId);
        emitVoiceTelemetry("bridge_started", {
          eventId: options.eventId,
          hostId: options.hostId,
          library,
          voice: clip.voice,
          variant: clip.variant,
          requestedGroupId: options.groupId,
          selectedGroupId: clip.groupId,
          clipText: clip.text,
          durationMs: clip.durationMs ?? undefined,
          outcome: bridgePlan.continuityMode
        });
      })
      .catch(() => cleanup("error"));
    return true;
  };

  const playNextLibrary = async (): Promise<void> => {
    if (stopped || audio) return;
    const neuralReady = currentBlobState() === "ready";
    const higherPriorityPending = Boolean(options.isHigherPriorityPending?.());
    const priority = options.priority ?? "routine";
    if (bridgePlan.continuityMode === "director-v2") {
      if (neuralReady) {
        emitVoiceTelemetry("bridge_skipped_ready", {
          eventId: options.eventId,
          hostId: options.hostId,
          durationMs: bridgeElapsedMs()
        });
        settleStartup();
        return;
      }
      if (higherPriorityPending && priority !== "breaking") {
        emitVoiceTelemetry("bridge_skipped_priority", {
          eventId: options.eventId,
          hostId: options.hostId,
          durationMs: bridgeElapsedMs()
        });
        settleStartup();
        return;
      }
      const canStart = shouldStartDirectorV2Guide({
        elapsedMs: bridgeElapsedMs(),
        playedGuideCount: playedClipCount,
        neuralReady,
        higherPriorityPending,
        priority
      });
      if (!canStart) {
        if (playedClipCount >= bridgePlan.maxGuides) {
          settleStartup();
          return;
        }
        const dueAt = playedClipCount === 0 ? bridgePlan.startDelayMs : bridgePlan.secondGuideEarliestMs;
        scheduleNextLibrary(Math.max(20, dueAt - bridgeElapsedMs()));
        return;
      }
    } else if (playedClipCount > 0 && neuralReady) {
      settleStartup();
      return;
    }
    if (bridgeBudgetReached()) {
      settleStartup();
      logBridgeBudgetReached();
      return;
    }
    if (libraries.length === 0) {
      settleStartup();
      return;
    }

    if (bridgePlan.continuityMode === "director-v2" && DIRECTOR_V2_GUIDE_SET === "official") {
      let attempts = 0;
      let attemptedPromotionalFallback = false;
      while (!stopped && !audio && attempts < 6) {
        const classId = drawDirectorV2GuideClass(priority, higherPriorityPending);
        if (classId === "promotional_channel") attemptedPromotionalFallback = true;
        const library =
          classId === "promotional_channel"
            ? OFFICIAL_PROMOTIONAL_GUIDE_LIBRARY
            : OFFICIAL_INFORMATIVE_GUIDE_LIBRARY;
        if (await playLibrary(library, classId)) return;
        attempts += 1;
      }
      if (
        !attemptedPromotionalFallback &&
        canUseDirectorV2PromotionalGuide(priority, higherPriorityPending)
      ) {
        if (await playLibrary(OFFICIAL_PROMOTIONAL_GUIDE_LIBRARY, "promotional_channel")) return;
      }
      if (!audio) settleStartup();
      return;
    }

    let attempts = 0;
    while (!stopped && !audio && attempts < libraries.length) {
      const library = libraries[nextLibraryIndex % libraries.length];
      nextLibraryIndex = (nextLibraryIndex + 1) % libraries.length;
      if (library && (await playLibrary(library, TRIAL_GUIDE_GROUP))) return;
      attempts += 1;
    }
    if (!audio) settleStartup();
  };

  return {
    arm() {
      bridgeArmedAt = performance.now();
      scheduleNextLibrary(bridgePlan.startDelayMs);
    },
    async stop(mode = "fade") {
      if (stopPromise) {
        if (mode === "immediate" && audio) detachAudio(audio, "immediate");
        return stopPromise;
      }
      if (
        mode === "finish" &&
        !audio &&
        bridgeArmedAt !== null &&
        !startupResolved &&
        bridgePlan.continuityMode !== "director-v2"
      ) {
        await startupPromise;
      }
      stopped = true;
      clearTimers();
      settleStartup();
      if (!audio) {
        if (mode === "finish" && playedClipCount > 0 && lastClipEndedAt !== null) {
          await playTransitionBeforeHandoff();
          await waitHandoffGap();
        }
        return;
      }

      const candidate = audio;
      if (mode === "finish") {
        const shouldPauseForHandoff = playedClipCount > 0;
        stopPromise = new Promise<void>((resolve) => {
          naturalCompletionResolve = resolve;
          const remainingMs =
            Number.isFinite(candidate.duration) && candidate.duration > 0
              ? Math.max(2_000, (candidate.duration - candidate.currentTime) * 1_000 + 2_000)
              : BRIDGE_FINISH_FALLBACK_TIMEOUT_MS;
          naturalCompletionTimer = window.setTimeout(
            () => {
              if (audio === candidate) detachAudio(candidate, "timeout");
            },
            Math.min(BRIDGE_FINISH_FALLBACK_TIMEOUT_MS, remainingMs)
          );
          if (audio !== candidate) resolve();
        })
          .then(async () => {
            if (shouldPauseForHandoff) {
              await playTransitionBeforeHandoff();
              await waitHandoffGap();
            }
          })
          .finally(() => {
            if (naturalCompletionTimer !== null) window.clearTimeout(naturalCompletionTimer);
            naturalCompletionTimer = null;
            naturalCompletionResolve = null;
            stopPromise = null;
          });
        return stopPromise;
      }

      stopPromise = (async () => {
        if (mode === "immediate") {
          detachAudio(candidate, "immediate");
          return;
        }

        const startedAt = performance.now();
        const initialVolume = candidate.volume;
        await new Promise<void>((resolve) => {
          const tick = () => {
            if (audio !== candidate) {
              resolve();
              return;
            }
            const elapsed = performance.now() - startedAt;
            const progress = Math.min(1, elapsed / BRIDGE_FADE_OUT_MS);
            candidate.volume = initialVolume * (1 - progress);
            if (progress >= 1) {
              detachAudio(candidate, "fade");
              resolve();
              return;
            }
            window.setTimeout(tick, 30);
          };
          tick();
        });
      })().finally(() => {
        stopPromise = null;
      });

      return stopPromise;
    }
  };
}

function resolveNeuralSpeaker(
  engine: NeuralEngine,
  hostId?: BroadcastVoiceHostId,
  speaker?: string
): string | undefined {
  if (speaker) return speaker;
  const host = findBroadcastHost(hostId ?? activeBroadcastHostId);
  const availableProfiles = neuralProfilesForEngine(engine);
  if (host.xttsProfile && availableProfiles.includes(host.xttsProfile)) {
    return host.xttsProfile;
  }
  if (engine === "chatterbox") {
    return host.xttsProfile ?? host.xttsSpeaker;
  }
  return host.xttsSpeaker;
}

export function getBroadcastVoiceHosts(): readonly BroadcastVoiceHost[] {
  return BROADCAST_VOICE_HOSTS;
}

export function getActiveBroadcastHost(): BroadcastVoiceHost {
  return findBroadcastHost(activeBroadcastHostId);
}

export function setActiveBroadcastHost(hostId: BroadcastVoiceHostId): void {
  activeBroadcastHostId = findBroadcastHost(hostId).id;
}

export function getNextBroadcastHost(
  hostId: BroadcastVoiceHostId = activeBroadcastHostId
): BroadcastVoiceHost {
  const currentIndex = BROADCAST_VOICE_HOSTS.findIndex((host) => host.id === hostId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % BROADCAST_VOICE_HOSTS.length : 0;
  return BROADCAST_VOICE_HOSTS[nextIndex] ?? BROADCAST_VOICE_HOSTS[0];
}

export function isEngineAvailable(engine: VoiceEngine): boolean {
  if (engine === "browser") return isBrowserVoiceSupported();
  return Boolean(healthSnapshot?.enabled && healthSnapshot.engines[engine]?.ok);
}

export async function refreshTtsHealth(signal?: AbortSignal): Promise<TtsHealth | null> {
  healthSnapshot = await fetchTtsHealth(signal);
  const engineOk =
    voiceEngine === "browser"
      ? isBrowserVoiceSupported()
      : Boolean(healthSnapshot?.enabled && healthSnapshot.engines[voiceEngine]?.ok);
  // Si no hay eleccion explicita, o el motor guardado hoy no existe/esta caido, cambia al
  // mejor motor disponible para que el selector y el prefetch queden coherentes con el arranque.
  if ((!engineExplicit && healthSnapshot) || !engineOk) {
    voiceEngine = bestAvailableVoiceEngine();
  }
  return healthSnapshot;
}

// --- API compatible con seismicSpeech.ts (misma firma) ---

export function isSeismicVoiceSupported(): boolean {
  return (
    isBrowserVoiceSupported() ||
    Boolean(
      healthSnapshot?.enabled &&
      (healthSnapshot.engines.chatterbox?.ok ||
        healthSnapshot.engines.piper?.ok ||
        healthSnapshot.engines.xtts?.ok)
    )
  );
}

export function isSeismicNarrationActive(): boolean {
  return (
    activeVoiceSessionCount > 0 ||
    activeBridgePlaybackCount > 0 ||
    isBrowserNarrationActive() ||
    isNeuralNarrationActive()
  );
}

export function primeSeismicVoices(): boolean {
  void refreshTtsHealth();
  return primeBrowserVoices();
}

export function setSeismicVoiceEnabled(enabled: boolean): boolean {
  voiceEnabled = enabled;
  // Mantiene el respaldo del navegador sincronizado y listo.
  const browserReady = setBrowserVoiceEnabled(enabled);
  if (!enabled) {
    releaseVoiceLease();
    stopActiveBridge("immediate");
    cancelNeuralNarration();
  }
  if (!enabled) return false;
  if (claimVoiceLease()) void claimRemoteVoiceLease();
  return browserReady || (voiceEngine !== "browser" && isEngineAvailable(voiceEngine));
}

export function cancelActiveSeismicNarration(): void {
  narrationSeq += 1;
  activeEventNarrationPlayback = null;
  stopActiveBridge("immediate");
  cancelNeuralNarration();
  cancelBrowserNarration();
}

export { buildSeismicNarration };

// La narracion de eventos en vivo mantiene hechos deterministas (lugar, magnitud,
// profundidad), pero puede pedir a DeepSeek solo la pauta editorial: intro, remate y cue.
export async function resolveEventNarration(
  event: SeismicEvent,
  options: { intro?: string; closing?: string | null; mode?: NarrationMode } = {}
): Promise<ResolvedNarrationPacket> {
  const key = narrationCacheKey(event, options);
  const cached = narrationCache.get(key);
  if (cached) return cached;

  const inFlight = inFlightNarrations.get(key);
  if (inFlight) return inFlight;

  const pending = (async (): Promise<ResolvedNarrationPacket> => {
    const mode = options.mode ?? (options.intro ? "breaking" : "seguimiento");
    const place = broadcastPlace(event);
    const country = broadcastCountryName(countryCode(event));
    const intro = options.intro?.trim() || undefined;
    const editorial =
      (await fetchNarrationEditorial(event, {
        normalizedPlace: place,
        country,
        mode,
        recentLines: getRecentEditorialLines()
      })) ?? fallbackNarrationEditorial(mode);
    const narrationIntro = pickEditorialIntro(intro, editorial.intro, place, country, mode);
    const mergedClosing = [
      editorial.tectonicContext,
      options.closing === undefined ? editorial.closing : options.closing
    ]
      .filter((value): value is string => Boolean(value && value.trim()))
      .filter((value, index, values) => {
        if (containsUnsupportedEditorialText(value)) return false;
        const canonical = canonicalizeEditorialText(value);
        return values.findIndex((candidate) => canonicalizeEditorialText(candidate) === canonical) === index;
      })
      .join(". ");
    const packet = {
      text: buildSeismicNarration(event, {
        intro: narrationIntro,
        place,
        closing: mergedClosing || null
      }),
      cue: editorial.cue,
      tectonicContext: editorial.tectonicContext
    } satisfies ResolvedNarrationPacket;
    rememberNarrationPacket(key, packet);
    return packet;
  })();

  inFlightNarrations.set(key, pending);
  void pending.finally(() => {
    if (inFlightNarrations.get(key) === pending) {
      inFlightNarrations.delete(key);
    }
  });
  return pending;
}

function resolvePlaybackNarrationPacket(
  event: SeismicEvent,
  options: EventNarrationOptions = {}
): Promise<ResolvedNarrationPacket> {
  if (options.resolved) return Promise.resolve(options.resolved);
  return resolveEventNarration(event, options);
}

export function prefetchSeismicNarration(
  event: SeismicEvent,
  enabled: boolean,
  options: EventNarrationOptions = {}
): void {
  if (!enabled || !voiceEnabled || !isVoiceOutputOwner() || voiceEngine === "browser") return;

  const engine = voiceEngine as NeuralEngine;
  if (!isEngineAvailable(engine)) return;
  if (engine === "chatterbox") {
    const libraries =
      options.continuityMode === "director-v2"
        ? orderedDirectorV2GuideLibraries(0)
        : [INFORMATIVE_GUIDE_LIBRARY, EDUCATIONAL_GUIDE_LIBRARY];
    for (const library of libraries) void loadBridgeManifest(library);
  }

  void resolvePlaybackNarrationPacket(event, options).then(({ text }) =>
    prefetchNeural(normalizeNeuralTextForEngine(text, engine), engine, {
      voice: resolveNeuralSpeaker(engine, options.hostId, options.speaker)
    })
  );
}

// Orden de intentos: el motor elegido primero, luego el resto de neurales por prioridad.
export function neuralFallbackOrder(start: NeuralEngine, allowFallback = true): NeuralEngine[] {
  if (!allowFallback) return [start];
  return [start, ...NEURAL_PRIORITY.filter((engine) => engine !== start)];
}

function deliveryForCue(text: string, cue: EditorialCue, kind: CueContextKind) {
  return cueToVoiceDelivery(cue, { text, kind });
}

function normalizeNeuralTextForEngine(text: string, engine: NeuralEngine): string {
  return engine === "chatterbox" ? normalizeChatterboxText(text) : normalizeSpokenText(text);
}

// Cascada XTTS-v2 -> Piper -> Navegador: prueba cada motor neural disponible en orden y,
// solo si todos fallan de verdad, cae a la voz del navegador. Una narracion superada por
// otra mas reciente termina en silencio (speakNeural resuelve sin lanzar).
async function runNeuralCascade(
  event: SeismicEvent,
  text: string,
  start: NeuralEngine,
  options: {
    force?: boolean;
    intro?: string;
    closing?: string | null;
    hostId?: BroadcastVoiceHostId;
    speaker?: string;
    cue: EditorialCue;
    kind: CueContextKind;
    allowFallback?: boolean;
    beforePlayback?: (engine: NeuralEngine) => Promise<void>;
    onBlobReady?: (metrics: NeuralBlobReadyMetrics) => void;
  }
): Promise<void> {
  const spokenText = normalizeNeuralTextForEngine(text, start);
  const delivery = deliveryForCue(spokenText, options.cue, options.kind);
  for (const engine of neuralFallbackOrder(start, options.allowFallback)) {
    if (!isEngineAvailable(engine)) continue;
    const engineText = engine === start ? spokenText : normalizeNeuralTextForEngine(text, engine);
    try {
      await speakNeural(engineText, engine, {
        voice: resolveNeuralSpeaker(engine, options.hostId, options.speaker),
        playbackRate: delivery.playbackRate,
        beforePlayback: () => options.beforePlayback?.(engine),
        onBlobReady: options.onBlobReady
      });
      return;
    } catch (error) {
      console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
    }
  }
  // Respaldo del navegador: corta cualquier audio neural para no solaparse.
  await options.beforePlayback?.(start);
  cancelNeuralNarration();
  speakBrowserNarration(event, true, {
    force: true,
    intro: options.intro,
    closing: options.closing,
    text,
    rate: delivery.rate
  });
}

// Resuelve el texto (IA -> plantilla, async) y locuta con el motor activo, descartando la
// narracion si otra mas reciente la supero mientras se resolvia el texto.
async function dispatchNarration(
  event: SeismicEvent,
  options: EventNarrationOptions & { force?: boolean },
  seq: number
): Promise<void> {
  const narrationStartedAt = performance.now();
  let outcome = "started";
  emitVoiceTelemetry("narration_requested", {
    eventId: event.eventId,
    hostId: options.hostId ?? activeBroadcastHostId
  });
  const releaseSession = beginVoiceSession();
  try {
    await finishActiveBridgePlayback();
    if (seq !== narrationSeq) {
      outcome = "superseded";
      return;
    }
    const { text, cue } = await resolvePlaybackNarrationPacket(event, options);
    if (seq !== narrationSeq) {
      outcome = "superseded";
      return;
    }
    emitVoiceTelemetry("narration_resolved", {
      eventId: event.eventId,
      hostId: options.hostId ?? activeBroadcastHostId,
      durationMs: performance.now() - narrationStartedAt
    });
    const delivery = deliveryForCue(text, cue, "evento");
    rememberEditorialLine(text);

    if (voiceEngine === "browser") {
      // Corta cualquier audio neural en curso para no solaparse con el navegador.
      clearActiveEventNarrationPlayback(seq);
      cancelNeuralNarration();
      speakBrowserNarration(event, true, {
        force: true,
        intro: options.intro,
        closing: options.closing,
        text,
        rate: delivery.rate
      });
      return;
    }

    const bridge = createBridgeHandle({
      engine: voiceEngine as NeuralEngine,
      text: normalizeNeuralTextForEngine(text, voiceEngine as NeuralEngine),
      hostId: options.hostId,
      speaker: options.speaker,
      eventId: event.eventId,
      groupId: classifyBridgeGroup(event),
      continuityMode: options.continuityMode,
      priority: options.mode === "breaking" || options.intro ? "breaking" : "routine",
      isHigherPriorityPending: options.isHigherPriorityPending
    });
    activeBridgeHandle = bridge;
    bridge.arm();
    let neuralPlaybackStartedAt: number | null = null;
    try {
      // Corta cualquier locucion del navegador (respaldo previo) antes de la voz neural.
      cancelBrowserNarration();
      await runNeuralCascade(event, text, voiceEngine as NeuralEngine, {
        ...options,
        cue,
        kind: "evento",
        allowFallback: !(options.mode === "breaking" || options.intro),
        onBlobReady: (metrics) =>
          recordBlobReadyMetrics(metrics, {
            eventId: event.eventId,
            hostId: options.hostId ?? activeBroadcastHostId
          }),
        beforePlayback: async (engine) => {
          await bridge.stop("finish");
          markActiveEventNarrationPlayback(event.eventId, engine, seq);
          neuralPlaybackStartedAt = performance.now();
          emitVoiceTelemetry("neural_started", {
            eventId: event.eventId,
            hostId: options.hostId ?? activeBroadcastHostId
          });
        }
      });
      outcome = "played";
      if (neuralPlaybackStartedAt !== null) {
        emitVoiceTelemetry("neural_ended", {
          eventId: event.eventId,
          hostId: options.hostId ?? activeBroadcastHostId,
          durationMs: performance.now() - neuralPlaybackStartedAt
        });
      }
    } finally {
      await bridge.stop("immediate");
      clearActiveEventNarrationPlayback(seq);
      if (activeBridgeHandle === bridge) activeBridgeHandle = null;
    }
  } finally {
    emitVoiceTelemetry("narration_finished", {
      eventId: event.eventId,
      hostId: options.hostId ?? activeBroadcastHostId,
      outcome,
      durationMs: performance.now() - narrationStartedAt
    });
    releaseSession();
  }
}

export function speakSeismicNarration(
  event: SeismicEvent,
  enabled: boolean,
  options: EventNarrationOptions & { force?: boolean } = {}
): boolean {
  if (!enabled || !voiceEnabled || !isVoiceOutputOwner()) return false;

  // Dedup para ambos motores (equivalente al de seismicSpeech.ts).
  const key = `${event.eventId}:${event.updatedAtUtc ?? event.eventTimeUtc}`;
  const now = Date.now();
  if (!options.force && key === lastSpeechKey && now - lastSpeechAt < SPEECH_DEDUP_WINDOW_MS) {
    return false;
  }
  lastSpeechKey = key;
  lastSpeechAt = now;

  const seq = ++narrationSeq;
  void dispatchNarration(event, options, seq);
  return true;
}

// Locuta un texto arbitrario (segmentos del director) con la misma cascada y cancelacion
// cruzada que la narracion de eventos.
async function dispatchText(text: string, seq: number, options: SpeakTextOptions = {}): Promise<void> {
  const narrationStartedAt = performance.now();
  let outcome = "started";
  if (options.eventId) {
    emitVoiceTelemetry("narration_requested", {
      eventId: options.eventId,
      hostId: activeBroadcastHostId
    });
  }
  const releaseSession = beginVoiceSession();
  try {
    await finishActiveBridgePlayback();
    if (seq !== narrationSeq) {
      outcome = "superseded";
      return;
    }
    const spokenText = normalizeNeuralTextForEngine(text, voiceEngine as NeuralEngine);
    const cue = options.cue ?? { urgency: "media", rhythm: "fluido", tone: "sobrio" };
    const delivery = deliveryForCue(spokenText, cue, options.kind ?? "recorrido");
    if (voiceEngine === "browser") {
      cancelNeuralNarration();
      speakBrowserText(spokenText, { rate: delivery.rate });
      return;
    }
    const bridge = createBridgeHandle({
      engine: voiceEngine as NeuralEngine,
      text: spokenText,
      eventId: options.eventId,
      hostId: activeBroadcastHostId,
      groupId: BRIDGE_FALLBACK_GROUP,
      continuityMode: options.continuityMode,
      priority: options.kind === "en-vivo" ? "breaking" : "routine",
      isHigherPriorityPending: options.isHigherPriorityPending
    });
    activeBridgeHandle = bridge;
    bridge.arm();
    let neuralPlaybackStartedAt: number | null = null;
    try {
      cancelBrowserNarration();
      const allowFallback = options.kind !== "en-vivo";
      for (const engine of neuralFallbackOrder(voiceEngine as NeuralEngine, allowFallback)) {
        if (!isEngineAvailable(engine)) continue;
        try {
          await speakNeural(spokenText, engine, {
            voice: resolveNeuralSpeaker(engine),
            playbackRate: delivery.playbackRate,
            onBlobReady: (metrics) =>
              recordBlobReadyMetrics(metrics, {
                eventId: options.eventId,
                hostId: activeBroadcastHostId
              }),
            beforePlayback: async () => {
              await bridge.stop("finish");
              neuralPlaybackStartedAt = performance.now();
              if (options.eventId) {
                emitVoiceTelemetry("neural_started", {
                  eventId: options.eventId,
                  hostId: activeBroadcastHostId
                });
              }
            }
          });
          outcome = "played";
          if (options.eventId && neuralPlaybackStartedAt !== null) {
            emitVoiceTelemetry("neural_ended", {
              eventId: options.eventId,
              hostId: activeBroadcastHostId,
              durationMs: performance.now() - neuralPlaybackStartedAt
            });
          }
          return;
        } catch (error) {
          console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
        }
      }
    } finally {
      await bridge.stop("immediate");
      if (activeBridgeHandle === bridge) activeBridgeHandle = null;
    }
    cancelNeuralNarration();
    speakBrowserText(spokenText, { rate: delivery.rate });
  } finally {
    if (options.eventId) {
      emitVoiceTelemetry("narration_finished", {
        eventId: options.eventId,
        hostId: activeBroadcastHostId,
        outcome,
        durationMs: performance.now() - narrationStartedAt
      });
    }
    releaseSession();
  }
}

async function dispatchTextWithSpeaker(text: string, seq: number, options: SpeakTextOptions): Promise<void> {
  const releaseSession = beginVoiceSession();
  try {
    await finishActiveBridgePlayback();
    if (seq !== narrationSeq) return;
    const spokenText = normalizeNeuralTextForEngine(text, voiceEngine as NeuralEngine);
    const cue = options.cue ?? { urgency: "media", rhythm: "fluido", tone: "sobrio" };
    const delivery = deliveryForCue(spokenText, cue, options.kind ?? "recorrido");
    if (voiceEngine === "browser") {
      cancelNeuralNarration();
      speakBrowserText(spokenText, { rate: delivery.rate });
      return;
    }
    const bridge = createBridgeHandle({
      engine: voiceEngine as NeuralEngine,
      text: spokenText,
      eventId: options.eventId,
      hostId: options.hostId,
      speaker: options.speaker,
      groupId: BRIDGE_FALLBACK_GROUP,
      continuityMode: options.continuityMode,
      priority: options.kind === "en-vivo" ? "breaking" : "routine",
      isHigherPriorityPending: options.isHigherPriorityPending
    });
    activeBridgeHandle = bridge;
    bridge.arm();
    try {
      cancelBrowserNarration();
      for (const engine of neuralFallbackOrder(voiceEngine as NeuralEngine)) {
        if (!isEngineAvailable(engine)) continue;
        try {
          await speakNeural(spokenText, engine, {
            voice: resolveNeuralSpeaker(engine, options.hostId, options.speaker),
            playbackRate: delivery.playbackRate,
            onBlobReady: (metrics) =>
              recordBlobReadyMetrics(metrics, {
                eventId: options.eventId,
                hostId: options.hostId ?? activeBroadcastHostId
              }),
            beforePlayback: () => bridge.stop("finish")
          });
          return;
        } catch (error) {
          console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
        }
      }
    } finally {
      await bridge.stop("immediate");
      if (activeBridgeHandle === bridge) activeBridgeHandle = null;
    }
    cancelNeuralNarration();
    speakBrowserText(spokenText, { rate: delivery.rate });
  } finally {
    releaseSession();
  }
}

export function speakText(text: string, options: SpeakTextOptions = {}): boolean {
  if (!voiceEnabled || !isVoiceOutputOwner()) return false;
  const value = text.trim();
  if (!value) return false;
  const seq = ++narrationSeq;
  if (!options.hostId && !options.speaker) {
    void dispatchText(value, seq, options);
    return true;
  }
  void dispatchTextWithSpeaker(value, seq, options);
  return true;
}

export function prefetchText(
  text: string,
  options: { hostId?: BroadcastVoiceHostId; speaker?: string } = {}
): void {
  if (!voiceEnabled || !isVoiceOutputOwner() || voiceEngine === "browser") return;
  const engine = voiceEngine as NeuralEngine;
  if (!isEngineAvailable(engine)) return;
  const value = normalizeNeuralTextForEngine(text.trim(), engine);
  if (value) {
    void prefetchNeural(value, engine, {
      voice: resolveNeuralSpeaker(engine, options.hostId, options.speaker)
    });
  }
}
