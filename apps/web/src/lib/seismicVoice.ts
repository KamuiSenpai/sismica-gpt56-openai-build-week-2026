// Orquestador de voz: elige el motor (Piper / XTTS-v2 / Navegador) y aplica un fallback
// en cascada. Re-exporta las mismas firmas que seismicSpeech.ts para que App.tsx solo
// cambie el import. seismicSpeech.ts (voz del navegador) queda intacto como RESPALDO.

import { type SeismicEvent } from "@sismica/shared";

import { fetchAiNarration } from "./api";
import {
  cancelNeuralNarration,
  fetchTtsHealth,
  isNeuralNarrationActive,
  prefetchNeural,
  speakNeural,
  type NeuralEngine,
  type TtsHealth
} from "./seismicNeuralSpeech";
import {
  buildSeismicNarration,
  cancelSeismicNarration as cancelBrowserNarration,
  isSeismicNarrationActive as isBrowserNarrationActive,
  isSeismicVoiceSupported as isBrowserVoiceSupported,
  primeSeismicVoices as primeBrowserVoices,
  setSeismicVoiceEnabled as setBrowserVoiceEnabled,
  speakSeismicNarration as speakBrowserNarration,
  speakSeismicText as speakBrowserText
} from "./seismicSpeech";

export type VoiceEngine = "piper" | "xtts" | "browser";

export const VOICE_ENGINES: readonly VoiceEngine[] = ["piper", "xtts", "browser"] as const;
export const VOICE_ENGINE_LABELS: Record<VoiceEngine, string> = {
  piper: "Piper",
  xtts: "XTTS-v2",
  browser: "Navegador"
};

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

// Narracion variada por IA (DeepSeek) con fallback a la plantilla local. El texto IA se
// cachea por evento en el servidor, asi que llamarlo varias veces (prefetch + locucion)
// no regenera ni gasta tokens de mas.
export async function resolveEventNarration(
  event: SeismicEvent,
  options: { intro?: string } = {}
): Promise<string> {
  const ai = await fetchAiNarration(event);
  if (ai) {
    const intro = options.intro?.trim();
    return intro ? `${intro}. ${ai}` : ai;
  }
  return buildSeismicNarration(event, options);
}

export function prefetchSeismicNarration(
  event: SeismicEvent,
  enabled: boolean,
  options: { intro?: string } = {}
): void {
  if (!enabled || !voiceEnabled || voiceEngine === "browser") return;

  const engine = voiceEngine as NeuralEngine;
  if (!isEngineAvailable(engine)) return;

  void resolveEventNarration(event, options).then((text) => prefetchNeural(text, engine));
}

// Orden de intentos: el motor elegido primero, luego el resto de neurales por prioridad.
function neuralFallbackOrder(start: NeuralEngine): NeuralEngine[] {
  return [start, ...NEURAL_PRIORITY.filter((engine) => engine !== start)];
}

// Cascada XTTS-v2 -> Piper -> Navegador: prueba cada motor neural disponible en orden y,
// solo si todos fallan de verdad, cae a la voz del navegador. Una narracion superada por
// otra mas reciente termina en silencio (speakNeural resuelve sin lanzar).
async function runNeuralCascade(
  event: SeismicEvent,
  text: string,
  start: NeuralEngine,
  options: { force?: boolean; intro?: string }
): Promise<void> {
  for (const engine of neuralFallbackOrder(start)) {
    if (!isEngineAvailable(engine)) continue;
    try {
      await speakNeural(text, engine);
      return;
    } catch (error) {
      console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
    }
  }
  // Respaldo del navegador: corta cualquier audio neural para no solaparse.
  cancelNeuralNarration();
  speakBrowserNarration(event, true, { ...options, text, force: true });
}

// Resuelve el texto (IA -> plantilla, async) y locuta con el motor activo, descartando la
// narracion si otra mas reciente la supero mientras se resolvia el texto.
async function dispatchNarration(
  event: SeismicEvent,
  options: { force?: boolean; intro?: string },
  seq: number
): Promise<void> {
  const text = await resolveEventNarration(event, options);
  if (seq !== narrationSeq) return;

  if (voiceEngine === "browser") {
    // Corta cualquier audio neural en curso para no solaparse con el navegador.
    cancelNeuralNarration();
    speakBrowserNarration(event, true, { ...options, text, force: true });
    return;
  }
  // Corta cualquier locucion del navegador (respaldo previo) antes de la voz neural.
  cancelBrowserNarration();
  await runNeuralCascade(event, text, voiceEngine as NeuralEngine, options);
}

export function speakSeismicNarration(
  event: SeismicEvent,
  enabled: boolean,
  options: { force?: boolean; intro?: string } = {}
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
async function dispatchText(text: string, seq: number): Promise<void> {
  if (seq !== narrationSeq) return;
  if (voiceEngine === "browser") {
    cancelNeuralNarration();
    speakBrowserText(text);
    return;
  }
  cancelBrowserNarration();
  for (const engine of neuralFallbackOrder(voiceEngine as NeuralEngine)) {
    if (!isEngineAvailable(engine)) continue;
    try {
      await speakNeural(text, engine);
      return;
    } catch (error) {
      console.warn(`Voz neural (${engine}) fallo; probando el siguiente motor.`, error);
    }
  }
  cancelNeuralNarration();
  speakBrowserText(text);
}

export function speakText(text: string): boolean {
  if (!voiceEnabled) return false;
  const value = text.trim();
  if (!value) return false;
  const seq = ++narrationSeq;
  void dispatchText(value, seq);
  return true;
}

export function prefetchText(text: string): void {
  if (!voiceEnabled || voiceEngine === "browser") return;
  const engine = voiceEngine as NeuralEngine;
  if (!isEngineAvailable(engine)) return;
  const value = text.trim();
  if (value) void prefetchNeural(value, engine);
}
