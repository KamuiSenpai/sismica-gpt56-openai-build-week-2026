// Orquestador de voz: elige el motor (Piper / XTTS-v2 / Navegador) y aplica un fallback
// en cascada. Re-exporta las mismas firmas que seismicSpeech.ts para que App.tsx solo
// cambie el import. seismicSpeech.ts (voz del navegador) queda intacto como RESPALDO.

import { type SeismicEvent } from "@sismica/shared";

import {
  cancelNeuralNarration,
  fetchTtsHealth,
  isNeuralNarrationActive,
  speakNeural,
  type NeuralEngine,
  type TtsHealth
} from "./seismicNeuralSpeech";
import {
  buildSeismicNarration,
  isSeismicNarrationActive as isBrowserNarrationActive,
  isSeismicVoiceSupported as isBrowserVoiceSupported,
  primeSeismicVoices as primeBrowserVoices,
  setSeismicVoiceEnabled as setBrowserVoiceEnabled,
  speakSeismicNarration as speakBrowserNarration
} from "./seismicSpeech";

export type VoiceEngine = "piper" | "xtts" | "browser";

export const VOICE_ENGINES: readonly VoiceEngine[] = ["piper", "xtts", "browser"] as const;
export const VOICE_ENGINE_LABELS: Record<VoiceEngine, string> = {
  piper: "Piper",
  xtts: "XTTS-v2",
  browser: "Navegador"
};

const STORAGE_KEY = "sismica.voiceEngine";
const SPEECH_DEDUP_WINDOW_MS = 4_000;

let voiceEnabled = false;
let engineExplicit = false;
let voiceEngine: VoiceEngine = loadEngine();
let healthSnapshot: TtsHealth | null = null;
let lastSpeechKey = "";
let lastSpeechAt = 0;

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
  // Si el usuario no eligio motor y hay uno neural disponible, seleccionarlo por defecto.
  if (!engineExplicit && healthSnapshot?.enabled) {
    if (healthSnapshot.engines.piper?.ok) voiceEngine = "piper";
    else if (healthSnapshot.engines.xtts?.ok) voiceEngine = "xtts";
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

export function speakSeismicNarration(
  event: SeismicEvent,
  enabled: boolean,
  options: { force?: boolean; intro?: string } = {}
): boolean {
  if (!enabled || !voiceEnabled) return false;

  if (voiceEngine === "browser") {
    return speakBrowserNarration(event, enabled, options);
  }

  // Dedup del camino neural (equivalente al de seismicSpeech.ts).
  const key = `${event.eventId}:${event.updatedAtUtc ?? event.eventTimeUtc}`;
  const now = Date.now();
  if (!options.force && key === lastSpeechKey && now - lastSpeechAt < SPEECH_DEDUP_WINDOW_MS) {
    return false;
  }
  lastSpeechKey = key;
  lastSpeechAt = now;

  const text = buildSeismicNarration(event, options);
  const engine = voiceEngine as NeuralEngine;

  void speakNeural(text, engine).catch((error) => {
    console.warn(`Voz neural (${engine}) no disponible; uso respaldo del navegador.`, error);
    speakBrowserNarration(event, true, { ...options, force: true });
  });

  return true;
}
