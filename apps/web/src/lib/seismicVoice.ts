// Orquestador de voz: elige el motor (Piper / XTTS-v2 / Navegador) y aplica un fallback
// en cascada. Re-exporta las mismas firmas que seismicSpeech.ts para que App.tsx solo
// cambie el import. seismicSpeech.ts (voz del navegador) queda intacto como RESPALDO.

import { type SeismicEvent } from "@sismica/shared";

import {
  fetchNarrationEditorial,
  fetchSeismicBridgeManifest,
  type SeismicBridgeLibrary,
  type SeismicBridgeManifest,
  type SeismicBridgeManifestItem
} from "./api";
import { getRecentEditorialLines, rememberEditorialLine } from "./editorialHistory";
import { broadcastCountryName, broadcastPlace } from "./broadcastPlace";
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
  isNeuralNarrationActive,
  prefetchNeural,
  speakNeural,
  speakNeuralSequence,
  type NeuralEngine,
  type NeuralSpeechRequest,
  type TtsHealth
} from "./seismicNeuralSpeech";
import {
  buildSeismicNarration,
  cancelSeismicNarration as cancelBrowserNarration,
  isSeismicNarrationActive as isBrowserNarrationActive,
  isSeismicVoiceSupported as isBrowserVoiceSupported,
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
export type BroadcastDialogueTurn = {
  hostId: BroadcastVoiceHostId;
  speakerName: string;
  text: string;
};
export type ResolvedNarrationPacket = {
  text: string;
  cue: EditorialCue;
  tectonicContext: string | null;
};

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
const BRIDGE_START_DELAY_MS = 350;
const BRIDGE_EXTENDED_DELAY_MS = 3_200;
const BRIDGE_FADE_OUT_MS = 180;
const BRIDGE_FALLBACK_GROUP = "continuidad_neutra";
const BRIDGE_SHORT_LIBRARY: SeismicBridgeLibrary = "short";
const BRIDGE_EXTENDED_LIBRARY: SeismicBridgeLibrary = "extended";
const BRIDGE_AVAILABLE_VOICES = new Set(["mx_carolina", "mx_liam"]);
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
const BRIDGE_PROFILE_BY_HOST: Record<BroadcastVoiceHostId, "mx_carolina" | "mx_liam"> = {
  carolina: "mx_carolina",
  liam: "mx_liam",
  valentina: "mx_carolina",
  martin: "mx_liam",
  sofia: "mx_carolina",
  ninoska: "mx_carolina"
};

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
const narrationCache = new Map<string, ResolvedNarrationPacket>();
const inFlightNarrations = new Map<string, Promise<ResolvedNarrationPacket>>();
const bridgeManifestCache = new Map<SeismicBridgeLibrary, Promise<SeismicBridgeManifest | null>>();
const lastBridgeVariantByPool = new Map<string, string>();

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

function classifyBridgeGroup(event: SeismicEvent): string {
  const place = canonicalizeEditorialText(broadcastPlace(event));
  const country = canonicalizeEditorialText(broadcastCountryName(countryCode(event)) ?? "");
  const combined = `${place} ${country}`.trim();
  const depth = event.depthKm ?? null;
  const shallow = typeof depth === "number" && depth <= 35;
  const intermediate = typeof depth === "number" && depth > 35 && depth < 120;
  const deep = typeof depth === "number" && depth >= 120;

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

function resolveBridgeVoiceProfile(
  hostId: BroadcastVoiceHostId = activeBroadcastHostId,
  speaker?: string
): "mx_carolina" | "mx_liam" {
  if (speaker && BRIDGE_AVAILABLE_VOICES.has(speaker)) {
    return speaker as "mx_carolina" | "mx_liam";
  }
  return BRIDGE_PROFILE_BY_HOST[hostId] ?? "mx_carolina";
}

async function loadBridgeManifest(library: SeismicBridgeLibrary): Promise<SeismicBridgeManifest | null> {
  const cached = bridgeManifestCache.get(library);
  if (cached) return cached;
  const pending = fetchSeismicBridgeManifest(library).catch(() => null);
  bridgeManifestCache.set(library, pending);
  return pending;
}

function pickBridgeCandidate(
  manifest: SeismicBridgeManifest,
  voice: string,
  groupId: string
): SeismicBridgeManifestItem | null {
  const pools = [
    manifest.items.filter((item) => item.voice === voice && item.groupId === groupId),
    manifest.items.filter((item) => item.voice === voice && item.groupId === BRIDGE_FALLBACK_GROUP),
    manifest.items.filter((item) => item.voice === voice)
  ];

  for (const candidates of pools) {
    if (candidates.length === 0) continue;
    const poolKey = `${manifest.library}|${voice}|${groupId}`;
    const previousVariant = lastBridgeVariantByPool.get(poolKey);
    const filtered = candidates.filter((item) => item.variant !== previousVariant);
    const pool = filtered.length > 0 ? filtered : candidates;
    const selected = pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? null;
    if (!selected) continue;
    lastBridgeVariantByPool.set(poolKey, selected.variant);
    return selected;
  }

  return null;
}

async function selectBridgeClip(
  library: SeismicBridgeLibrary,
  voice: string,
  groupId: string
): Promise<SeismicBridgeManifestItem | null> {
  const manifest = await loadBridgeManifest(library);
  if (!manifest) return null;
  return pickBridgeCandidate(manifest, voice, groupId);
}

type BridgeHandle = {
  arm(): void;
  stop(mode?: "fade" | "immediate"): Promise<void>;
};

function createBridgeHandle(options: {
  engine: NeuralEngine;
  text: string;
  hostId?: BroadcastVoiceHostId;
  speaker?: string;
  groupId: string;
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

  const voice = resolveBridgeVoiceProfile(options.hostId, options.speaker);
  const blobState = getNeuralBlobState(options.text, options.engine, {
    voice: resolveNeuralSpeaker(options.engine, options.hostId, options.speaker)
  });
  if (blobState === "ready") {
    return {
      arm() {
        // La locucion ya esta cacheada; no hace falta puente.
      },
      async stop() {
        // Nada que cerrar.
      }
    };
  }

  let audio: HTMLAudioElement | null = null;
  let pendingExtended = false;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  const timers: number[] = [];

  const clearTimers = () => {
    while (timers.length > 0) {
      window.clearTimeout(timers.pop());
    }
  };

  const detachAudio = (candidate: HTMLAudioElement | null = audio) => {
    if (!candidate) return;
    if (audio === candidate) {
      audio = null;
      activeBridgePlaybackCount = Math.max(0, activeBridgePlaybackCount - 1);
    }
    candidate.pause();
    candidate.src = "";
  };

  const playLibrary = async (library: SeismicBridgeLibrary): Promise<void> => {
    if (stopped || audio) return;
    const clip = await selectBridgeClip(library, voice, options.groupId);
    if (!clip || stopped || audio) return;

    const candidate = new Audio(clip.url);
    candidate.preload = "auto";
    candidate.volume = 1;
    audio = candidate;
    activeBridgePlaybackCount += 1;

    const continueIfNeeded = () => {
      if (stopped || !pendingExtended) return;
      pendingExtended = false;
      void playLibrary(BRIDGE_EXTENDED_LIBRARY);
    };

    const cleanup = () => {
      detachAudio(candidate);
      continueIfNeeded();
    };

    candidate.addEventListener("ended", cleanup, { once: true });
    candidate.addEventListener("error", cleanup, { once: true });
    void candidate.play().catch(() => {
      cleanup();
    });
  };

  return {
    arm() {
      timers.push(
        window.setTimeout(() => {
          void playLibrary(BRIDGE_SHORT_LIBRARY);
        }, BRIDGE_START_DELAY_MS)
      );
      timers.push(
        window.setTimeout(() => {
          if (stopped) return;
          if (audio) {
            pendingExtended = true;
            return;
          }
          void playLibrary(BRIDGE_EXTENDED_LIBRARY);
        }, BRIDGE_EXTENDED_DELAY_MS)
      );
    },
    async stop(mode = "fade") {
      if (stopPromise) return stopPromise;
      stopped = true;
      pendingExtended = false;
      clearTimers();
      if (!audio) return;

      const candidate = audio;
      stopPromise = (async () => {
        if (mode === "immediate") {
          detachAudio(candidate);
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
              detachAudio(candidate);
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

function dialogueFallback(turns: BroadcastDialogueTurn[]): string {
  return turns.map((turn) => `${turn.speakerName}: ${turn.text}`).join(" ");
}

function neuralDialogue(
  turns: BroadcastDialogueTurn[],
  engine: NeuralEngine,
  playbackRate = 1.04
): Array<NeuralSpeechRequest & { playbackRate?: number }> {
  return turns.map((turn) => ({
    text: normalizeSpokenText(turn.text),
    voice: resolveNeuralSpeaker(engine, turn.hostId),
    playbackRate
  }));
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
  if (!enabled) cancelNeuralNarration();
  if (!enabled) return false;
  return browserReady || (voiceEngine !== "browser" && isEngineAvailable(voiceEngine));
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

export function prefetchSeismicNarration(
  event: SeismicEvent,
  enabled: boolean,
  options: {
    intro?: string;
    closing?: string | null;
    mode?: NarrationMode;
    hostId?: BroadcastVoiceHostId;
    speaker?: string;
  } = {}
): void {
  if (!enabled || !voiceEnabled || voiceEngine === "browser") return;

  const engine = voiceEngine as NeuralEngine;
  if (!isEngineAvailable(engine)) return;
  if (engine === "chatterbox") {
    void loadBridgeManifest(BRIDGE_SHORT_LIBRARY);
    void loadBridgeManifest(BRIDGE_EXTENDED_LIBRARY);
  }

  void resolveEventNarration(event, options).then(({ text }) =>
    prefetchNeural(normalizeSpokenText(text), engine, {
      voice: resolveNeuralSpeaker(engine, options.hostId, options.speaker)
    })
  );
}

// Orden de intentos: el motor elegido primero, luego el resto de neurales por prioridad.
function neuralFallbackOrder(start: NeuralEngine): NeuralEngine[] {
  return [start, ...NEURAL_PRIORITY.filter((engine) => engine !== start)];
}

function deliveryForCue(text: string, cue: EditorialCue, kind: CueContextKind) {
  return cueToVoiceDelivery(cue, { text, kind });
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
    beforePlayback?: () => Promise<void>;
  }
): Promise<void> {
  const spokenText = normalizeSpokenText(text);
  const delivery = deliveryForCue(spokenText, options.cue, options.kind);
  for (const engine of neuralFallbackOrder(start)) {
    if (!isEngineAvailable(engine)) continue;
    try {
      await speakNeural(spokenText, engine, {
        voice: resolveNeuralSpeaker(engine, options.hostId, options.speaker),
        playbackRate: delivery.playbackRate,
        beforePlayback: options.beforePlayback
      });
      return;
    } catch (error) {
      console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
    }
  }
  // Respaldo del navegador: corta cualquier audio neural para no solaparse.
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
  options: {
    force?: boolean;
    intro?: string;
    closing?: string | null;
    mode?: NarrationMode;
    hostId?: BroadcastVoiceHostId;
    speaker?: string;
  },
  seq: number
): Promise<void> {
  const releaseSession = beginVoiceSession();
  try {
    const { text, cue } = await resolveEventNarration(event, options);
    if (seq !== narrationSeq) return;
    const delivery = deliveryForCue(text, cue, "evento");
    rememberEditorialLine(text);

    if (voiceEngine === "browser") {
      // Corta cualquier audio neural en curso para no solaparse con el navegador.
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
      text: normalizeSpokenText(text),
      hostId: options.hostId,
      speaker: options.speaker,
      groupId: classifyBridgeGroup(event)
    });
    bridge.arm();
    try {
      // Corta cualquier locucion del navegador (respaldo previo) antes de la voz neural.
      cancelBrowserNarration();
      await runNeuralCascade(event, text, voiceEngine as NeuralEngine, {
        ...options,
        cue,
        kind: "evento",
        beforePlayback: () => bridge.stop("fade")
      });
    } finally {
      await bridge.stop("immediate");
    }
  } finally {
    releaseSession();
  }
}

export function speakSeismicNarration(
  event: SeismicEvent,
  enabled: boolean,
  options: {
    force?: boolean;
    intro?: string;
    closing?: string | null;
    mode?: NarrationMode;
    hostId?: BroadcastVoiceHostId;
    speaker?: string;
  } = {}
): boolean {
  if (!enabled || !voiceEnabled) return false;

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
async function dispatchText(
  text: string,
  seq: number,
  options: { cue?: EditorialCue; kind?: CueContextKind } = {}
): Promise<void> {
  const releaseSession = beginVoiceSession();
  try {
    if (seq !== narrationSeq) return;
    const spokenText = normalizeSpokenText(text);
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
      hostId: activeBroadcastHostId,
      groupId: BRIDGE_FALLBACK_GROUP
    });
    bridge.arm();
    try {
      cancelBrowserNarration();
      for (const engine of neuralFallbackOrder(voiceEngine as NeuralEngine)) {
        if (!isEngineAvailable(engine)) continue;
        try {
          await speakNeural(spokenText, engine, {
            voice: resolveNeuralSpeaker(engine),
            playbackRate: delivery.playbackRate,
            beforePlayback: () => bridge.stop("fade")
          });
          return;
        } catch (error) {
          console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
        }
      }
    } finally {
      await bridge.stop("immediate");
    }
    cancelNeuralNarration();
    speakBrowserText(spokenText, { rate: delivery.rate });
  } finally {
    releaseSession();
  }
}

async function dispatchTextWithSpeaker(
  text: string,
  seq: number,
  options: { hostId?: BroadcastVoiceHostId; speaker?: string; cue?: EditorialCue; kind?: CueContextKind }
): Promise<void> {
  const releaseSession = beginVoiceSession();
  try {
    if (seq !== narrationSeq) return;
    const spokenText = normalizeSpokenText(text);
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
      hostId: options.hostId,
      speaker: options.speaker,
      groupId: BRIDGE_FALLBACK_GROUP
    });
    bridge.arm();
    try {
      cancelBrowserNarration();
      for (const engine of neuralFallbackOrder(voiceEngine as NeuralEngine)) {
        if (!isEngineAvailable(engine)) continue;
        try {
          await speakNeural(spokenText, engine, {
            voice: resolveNeuralSpeaker(engine, options.hostId, options.speaker),
            playbackRate: delivery.playbackRate,
            beforePlayback: () => bridge.stop("fade")
          });
          return;
        } catch (error) {
          console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
        }
      }
    } finally {
      await bridge.stop("immediate");
    }
    cancelNeuralNarration();
    speakBrowserText(spokenText, { rate: delivery.rate });
  } finally {
    releaseSession();
  }
}

export function speakText(
  text: string,
  options: {
    hostId?: BroadcastVoiceHostId;
    speaker?: string;
    cue?: EditorialCue;
    kind?: CueContextKind;
  } = {}
): boolean {
  if (!voiceEnabled) return false;
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
  if (!voiceEnabled || voiceEngine === "browser") return;
  const engine = voiceEngine as NeuralEngine;
  if (!isEngineAvailable(engine)) return;
  const value = normalizeSpokenText(text.trim());
  if (value) {
    void prefetchNeural(value, engine, {
      voice: resolveNeuralSpeaker(engine, options.hostId, options.speaker)
    });
  }
}

async function dispatchDialogue(turns: BroadcastDialogueTurn[], seq: number): Promise<void> {
  const releaseSession = beginVoiceSession();
  try {
    if (seq !== narrationSeq) return;
    const delivery = deliveryForCue(
      dialogueFallback(turns),
      { urgency: "media", rhythm: "fluido", tone: "directo" },
      "relevo"
    );

    if (voiceEngine === "browser" || !isEngineAvailable(voiceEngine)) {
      cancelNeuralNarration();
      speakBrowserText(dialogueFallback(turns), { rate: delivery.rate });
      return;
    }

    const engine = voiceEngine as NeuralEngine;
    cancelBrowserNarration();
    try {
      await speakNeuralSequence(neuralDialogue(turns, engine, delivery.playbackRate), engine);
    } catch (error) {
      console.warn(`Dialogo ${engine} fallo; usando respaldo del navegador.`, error);
      cancelNeuralNarration();
      speakBrowserText(dialogueFallback(turns), { rate: delivery.rate });
    }
  } finally {
    releaseSession();
  }
}

export function prefetchDialogue(turns: BroadcastDialogueTurn[]): void {
  if (!voiceEnabled || voiceEngine === "browser" || !isEngineAvailable(voiceEngine)) return;
  const engine = voiceEngine as NeuralEngine;
  for (const turn of turns) {
    void prefetchNeural(normalizeSpokenText(turn.text), engine, {
      voice: resolveNeuralSpeaker(engine, turn.hostId)
    });
  }
}

export function speakDialogue(turns: BroadcastDialogueTurn[]): boolean {
  if (!voiceEnabled || turns.length === 0) return false;
  const seq = ++narrationSeq;
  void dispatchDialogue(turns, seq);
  return true;
}
