// Orquestador de voz: elige el motor (Piper / XTTS-v2 / Navegador) y aplica un fallback
// en cascada. Re-exporta las mismas firmas que seismicSpeech.ts para que App.tsx solo
// cambie el import. seismicSpeech.ts (voz del navegador) queda intacto como RESPALDO.

import { type SeismicEvent } from "@sismica/shared";

import { fetchNarrationEditorial } from "./api";
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
  cancelNeuralNarration,
  fetchTtsHealth,
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

export type VoiceEngine = "piper" | "xtts" | "browser";
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

export const VOICE_ENGINES: readonly VoiceEngine[] = ["piper", "xtts", "browser"] as const;
export const VOICE_ENGINE_LABELS: Record<VoiceEngine, string> = {
  piper: "Piper",
  xtts: "XTTS-v2",
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
const NEURAL_PRIORITY: readonly NeuralEngine[] = ["xtts", "piper"] as const;
// Incluye frases de "continuidad" de TV que no aplican a un directo 24/7 continuo:
// pausas, cortes comerciales, publicidad y despedidas del tipo "volvemos/regresamos".
const UNSUPPORTED_EDITORIAL_CLAIM_PATTERN =
  /\b(replic(?:a|as)|tsunami|dan(?:o|os)|victimas|heridos|alerta|evacua(?:cion|r)|riesgo|sin reportes?|pausa|comercial(?:es)?|publicidad|publicitari\w*|volvemos|volveremos|regresamos|regresaremos|informacion en desarrollo|(?:no (?:tenemos|hay)|sin) (?:mas|mayor) informacion|(?:seguimos|continuamos) (?:recopilando|reuniendo|recabando) informacion|(?:seguiremos|continuaremos|ampliaremos) (?:recopilando|reuniendo|recabando|ampliando) (?:la )?informacion)\b/u;
// Aperturas validas POR MODO (espejo del API). "Nuevo sismo..." solo es legitimo en breaking
// (sismo que recien ingresa); en seguimiento/recorrido solo caben las de FOLLOWUP.
const BREAKING_EDITORIAL_INTROS = new Set([
  "nuevo sismo detectado",
  "se registra un nuevo sismo",
  "actualizacion sismica reciente",
  "nuevo evento sismico en monitoreo"
]);
const FOLLOWUP_EDITORIAL_INTROS = new Set([
  "sismo detectado",
  "evento sismico en seguimiento",
  "reporte sismico en monitoreo"
]);

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

let voiceEnabled = false;
let engineExplicit = false;
let voiceEngine: VoiceEngine = loadEngine();
let healthSnapshot: TtsHealth | null = null;
let lastSpeechKey = "";
let lastSpeechAt = 0;
let activeBroadcastHostId: BroadcastVoiceHostId = BROADCAST_VOICE_HOSTS[0].id;
// Secuencia de narraciones: al resolver el texto (IA es async) descarta las superadas.
let narrationSeq = 0;

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

function loadEngine(): VoiceEngine {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "piper" || stored === "xtts" || stored === "browser") {
      engineExplicit = true;
      return stored;
    }
  } catch {
    // localStorage no disponible: usa el respaldo.
  }
  return "browser";
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

export function getTtsHealthSnapshot(): TtsHealth | null {
  return healthSnapshot;
}

function findBroadcastHost(id: BroadcastVoiceHostId): BroadcastVoiceHost {
  return BROADCAST_VOICE_HOSTS.find((host) => host.id === id) ?? BROADCAST_VOICE_HOSTS[0];
}

function resolveXttsSpeaker(hostId?: BroadcastVoiceHostId, speaker?: string): string | undefined {
  if (speaker) return speaker;
  const host = findBroadcastHost(hostId ?? activeBroadcastHostId);
  const availableProfiles = healthSnapshot?.engines.xtts.profiles ?? [];
  if (host.xttsProfile && availableProfiles.includes(host.xttsProfile)) {
    return host.xttsProfile;
  }
  return host.xttsSpeaker;
}

function dialogueFallback(turns: BroadcastDialogueTurn[]): string {
  return turns.map((turn) => `${turn.speakerName}: ${turn.text}`).join(" ");
}

function neuralDialogue(
  turns: BroadcastDialogueTurn[],
  playbackRate = 1.04
): Array<NeuralSpeechRequest & { playbackRate?: number }> {
  return turns.map((turn) => ({
    text: normalizeSpokenText(turn.text),
    voice: resolveXttsSpeaker(turn.hostId),
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
  // Si el usuario no eligio motor y hay uno neural disponible, seleccionarlo por defecto
  // segun la prioridad (XTTS-v2 primero, luego Piper).
  if (!engineExplicit && healthSnapshot?.enabled) {
    const preferred = NEURAL_PRIORITY.find((engine) => healthSnapshot?.engines[engine]?.ok);
    if (preferred) voiceEngine = preferred;
  }
  return healthSnapshot;
}

// --- API compatible con seismicSpeech.ts (misma firma) ---

export function isSeismicVoiceSupported(): boolean {
  return (
    isBrowserVoiceSupported() ||
    Boolean(healthSnapshot?.enabled && (healthSnapshot.engines.piper?.ok || healthSnapshot.engines.xtts?.ok))
  );
}

export function isSeismicNarrationActive(): boolean {
  return isBrowserNarrationActive() || isNeuralNarrationActive();
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
  const text = buildSeismicNarration(event, {
    intro: narrationIntro,
    place,
    closing: mergedClosing || null
  });
  return {
    text,
    cue: editorial.cue,
    tectonicContext: editorial.tectonicContext
  };
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

  void resolveEventNarration(event, options).then(({ text }) =>
    prefetchNeural(normalizeSpokenText(text), engine, {
      voice: resolveXttsSpeaker(options.hostId, options.speaker)
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
  }
): Promise<void> {
  const spokenText = normalizeSpokenText(text);
  const delivery = deliveryForCue(spokenText, options.cue, options.kind);
  for (const engine of neuralFallbackOrder(start)) {
    if (!isEngineAvailable(engine)) continue;
    try {
      await speakNeural(spokenText, engine, {
        voice: resolveXttsSpeaker(options.hostId, options.speaker),
        playbackRate: delivery.playbackRate
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
  // Corta cualquier locucion del navegador (respaldo previo) antes de la voz neural.
  cancelBrowserNarration();
  await runNeuralCascade(event, text, voiceEngine as NeuralEngine, {
    ...options,
    cue,
    kind: "evento"
  });
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
  if (seq !== narrationSeq) return;
  const spokenText = normalizeSpokenText(text);
  const cue = options.cue ?? { urgency: "media", rhythm: "fluido", tone: "sobrio" };
  const delivery = deliveryForCue(spokenText, cue, options.kind ?? "recorrido");
  if (voiceEngine === "browser") {
    cancelNeuralNarration();
    speakBrowserText(spokenText, { rate: delivery.rate });
    return;
  }
  cancelBrowserNarration();
  for (const engine of neuralFallbackOrder(voiceEngine as NeuralEngine)) {
    if (!isEngineAvailable(engine)) continue;
    try {
      await speakNeural(spokenText, engine, {
        voice: resolveXttsSpeaker(),
        playbackRate: delivery.playbackRate
      });
      return;
    } catch (error) {
      console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
    }
  }
  cancelNeuralNarration();
  speakBrowserText(spokenText, { rate: delivery.rate });
}

async function dispatchTextWithSpeaker(
  text: string,
  seq: number,
  options: { hostId?: BroadcastVoiceHostId; speaker?: string; cue?: EditorialCue; kind?: CueContextKind }
): Promise<void> {
  if (seq !== narrationSeq) return;
  const spokenText = normalizeSpokenText(text);
  const cue = options.cue ?? { urgency: "media", rhythm: "fluido", tone: "sobrio" };
  const delivery = deliveryForCue(spokenText, cue, options.kind ?? "recorrido");
  if (voiceEngine === "browser") {
    cancelNeuralNarration();
    speakBrowserText(spokenText, { rate: delivery.rate });
    return;
  }
  cancelBrowserNarration();
  for (const engine of neuralFallbackOrder(voiceEngine as NeuralEngine)) {
    if (!isEngineAvailable(engine)) continue;
    try {
      await speakNeural(spokenText, engine, {
        voice: resolveXttsSpeaker(options.hostId, options.speaker),
        playbackRate: delivery.playbackRate
      });
      return;
    } catch (error) {
      console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
    }
  }
  cancelNeuralNarration();
  speakBrowserText(spokenText, { rate: delivery.rate });
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
      voice: resolveXttsSpeaker(options.hostId, options.speaker)
    });
  }
}

async function dispatchDialogue(turns: BroadcastDialogueTurn[], seq: number): Promise<void> {
  if (seq !== narrationSeq) return;
  const delivery = deliveryForCue(
    dialogueFallback(turns),
    { urgency: "media", rhythm: "fluido", tone: "directo" },
    "relevo"
  );

  if (voiceEngine !== "xtts" || !isEngineAvailable("xtts")) {
    cancelNeuralNarration();
    speakBrowserText(dialogueFallback(turns), { rate: delivery.rate });
    return;
  }

  cancelBrowserNarration();
  try {
    await speakNeuralSequence(neuralDialogue(turns, delivery.playbackRate), "xtts");
  } catch (error) {
    console.warn("Dialogo XTTS fallo; usando respaldo del navegador.", error);
    cancelNeuralNarration();
    speakBrowserText(dialogueFallback(turns), { rate: delivery.rate });
  }
}

export function prefetchDialogue(turns: BroadcastDialogueTurn[]): void {
  if (!voiceEnabled || voiceEngine !== "xtts" || !isEngineAvailable("xtts")) return;
  for (const turn of turns) {
    void prefetchNeural(normalizeSpokenText(turn.text), "xtts", {
      voice: resolveXttsSpeaker(turn.hostId)
    });
  }
}

export function speakDialogue(turns: BroadcastDialogueTurn[]): boolean {
  if (!voiceEnabled || turns.length === 0) return false;
  const seq = ++narrationSeq;
  void dispatchDialogue(turns, seq);
  return true;
}
