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
// Secuencia de peticiones: una narracion mas reciente invalida a las anteriores, para que
// XTTS (aun siendo lento) no se reproduzca ni caiga al respaldo cuando ya fue superada.
let activeController: AbortController | null = null;
let requestSeq = 0;

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
  requestSeq += 1;
  activeController?.abort();
  activeController = null;
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

// Sintetiza y reproduce. Lanza SOLO ante un fallo real (motor no disponible, error de red,
// timeout o fallo de reproduccion) para que el orquestador caiga al respaldo del navegador.
// Si una narracion mas reciente la supera (o se cancela), termina en silencio sin respaldo.
export async function speakNeural(text: string, engine: NeuralEngine): Promise<void> {
  const seq = ++requestSeq;
  activeController?.abort(); // cancela la peticion anterior en vuelo
  const controller = new AbortController();
  activeController = controller;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/tts?engine=${engine}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(SYNTH_TIMEOUT_MS)])
    });
  } catch (error) {
    if (controller.signal.aborted) return; // superada/cancelada: sin respaldo
    throw error; // timeout o red: el orquestador cae al navegador
  }

  if (seq !== requestSeq) return; // superada mientras llegaba la respuesta
  if (!response.ok) {
    throw new Error(`TTS ${engine} respondio ${response.status}`);
  }

  const blob = await response.blob();
  if (seq !== requestSeq) return; // superada durante la lectura del audio

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

  try {
    await audio.play();
  } catch (error) {
    if (seq !== requestSeq || controller.signal.aborted) return; // interrumpida por otra
    throw error; // fallo real de reproduccion: respaldo del navegador
  }
}
