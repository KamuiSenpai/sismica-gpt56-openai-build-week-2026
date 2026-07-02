// Orquestador de voz: elige el motor (Piper / XTTS-v2 / Navegador) y aplica un fallback
// en cascada. Re-exporta las mismas firmas que seismicSpeech.ts para que App.tsx solo
// cambie el import. seismicSpeech.ts (voz del navegador) queda intacto como RESPALDO.

import { type SeismicEvent } from "@sismica/shared";

import { fetchNarrationEditorial } from "./api";
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
export type BroadcastVoiceHostId = "claribel" | "andrew";
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
type ResolvedNarration = { text: string; cue: EditorialCue };

export const VOICE_ENGINES: readonly VoiceEngine[] = ["piper", "xtts", "browser"] as const;
export const VOICE_ENGINE_LABELS: Record<VoiceEngine, string> = {
  piper: "Piper",
  xtts: "XTTS-v2",
  browser: "Navegador"
};
export const BROADCAST_VOICE_HOSTS: readonly BroadcastVoiceHost[] = [
  { id: "claribel", name: "Claribel", xttsSpeaker: "Claribel Dervla", xttsProfile: "mx_claribel" },
  { id: "andrew", name: "Andrew", xttsSpeaker: "Andrew Chipper", xttsProfile: "mx_andrew" }
] as const;

// Orden de preferencia neural (autoseleccion y cascada de fallback): XTTS-v2 primero,
// luego Piper y, si todos fallan, la voz del navegador.
const NEURAL_PRIORITY: readonly NeuralEngine[] = ["xtts", "piper"] as const;

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
): Promise<ResolvedNarration> {
  const mode = options.mode ?? (options.intro ? "breaking" : "seguimiento");
  const place = broadcastPlace(event);
  const country = broadcastCountryName(countryCode(event));
  const editorial =
    (await fetchNarrationEditorial(event, {
      normalizedPlace: place,
      country,
      mode
    })) ?? fallbackNarrationEditorial(mode);
  const text = buildSeismicNarration(event, {
    intro: options.intro?.trim() || editorial.intro,
    place,
    closing: options.closing === undefined ? editorial.closing : options.closing
  });
  return { text, cue: editorial.cue };
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
