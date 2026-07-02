// Capa de voz neural: pide el audio al API (/api/tts) y lo reproduce en el navegador.
// El API enruta a Piper (binario local) o hace proxy a XTTS-v2 (servicio Python).

export type NeuralEngine = "piper" | "xtts";

export type TtsEngineHealth = { ok: boolean; voice?: string; detail?: string };
export type TtsHealth = {
  enabled: boolean;
  engines: Record<NeuralEngine, TtsEngineHealth>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const SYNTH_TIMEOUT_MS = 30_000;

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

function stopCurrent(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

export function cancelNeuralNarration(): void {
  stopCurrent();
}

export function isNeuralNarrationActive(): boolean {
  return currentAudio !== null && !currentAudio.paused && !currentAudio.ended;
}

export async function fetchTtsHealth(signal?: AbortSignal): Promise<TtsHealth | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tts/health`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as TtsHealth;
  } catch {
    return null;
  }
}

// Sintetiza y reproduce. Lanza si el motor no esta disponible o la reproduccion falla,
// para que el orquestador pueda caer al respaldo del navegador.
export async function speakNeural(text: string, engine: NeuralEngine): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/tts?engine=${engine}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(SYNTH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`TTS ${engine} respondio ${response.status}`);
  }

  const blob = await response.blob();
  stopCurrent();

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  currentUrl = url;

  const cleanup = () => {
    if (currentAudio === audio) stopCurrent();
  };
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });

  await audio.play();
}
