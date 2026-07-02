// Capa de voz neural: pide el audio al API (/api/tts) y lo reproduce en el navegador.
// El API enruta a Piper (binario local) o hace proxy a XTTS-v2 (servicio Python).

export type NeuralEngine = "piper" | "xtts";
export type NeuralSpeechOptions = { voice?: string; playbackRate?: number };
export type NeuralSpeechRequest = { text: string; voice?: string };

export type TtsEngineHealth = { ok: boolean; voice?: string; detail?: string; profiles?: string[] };
export type TtsHealth = {
  enabled: boolean;
  engines: Record<NeuralEngine, TtsEngineHealth>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const SYNTH_TIMEOUT_MS = 120_000;
const PREFETCH_CACHE_LIMIT = 8;

// Cache de audios ya sintetizados (Blob) para reproducir sin ida y vuelta a la red.
const blobCache = new Map<string, Blob>();
const inFlightPrefetch = new Map<string, Promise<Blob | null>>();

function cacheKey(engine: NeuralEngine, text: string, voice?: string): string {
  return `${engine}|${voice ?? "default"}|${text}`;
}

function rememberBlob(key: string, blob: Blob): void {
  blobCache.delete(key); // reinserta al final (mantiene orden de reciente)
  blobCache.set(key, blob);
  while (blobCache.size > PREFETCH_CACHE_LIMIT) {
    const oldest = blobCache.keys().next().value;
    if (oldest === undefined) break;
    blobCache.delete(oldest);
  }
}

async function requestNeuralBlob(
  request: NeuralSpeechRequest,
  engine: NeuralEngine,
  signal: AbortSignal
): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/tts?engine=${engine}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: request.text, voice: request.voice }),
    signal
  });
  if (!response.ok) {
    throw new Error(`TTS ${engine} respondio ${response.status}`);
  }
  return response.blob();
}

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

async function obtainBlob(
  request: NeuralSpeechRequest,
  engine: NeuralEngine,
  controller: AbortController,
  seq: number
): Promise<Blob | null> {
  const key = cacheKey(engine, request.text, request.voice);
  let blob = blobCache.get(key) ?? null;

  if (!blob && inFlightPrefetch.has(key)) {
    blob = (await inFlightPrefetch.get(key)) ?? null;
    if (seq !== requestSeq || controller.signal.aborted) return null;
    if (!blob) {
      throw new Error(`TTS ${engine} no disponible desde prefetch`);
    }
  }

  if (!blob) {
    try {
      blob = await requestNeuralBlob(
        request,
        engine,
        AbortSignal.any([controller.signal, AbortSignal.timeout(SYNTH_TIMEOUT_MS)])
      );
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    }

    if (seq !== requestSeq || controller.signal.aborted) return null;
    rememberBlob(key, blob);
  }

  return blob;
}

function playBlob(blob: Blob, controller: AbortController, seq: number, playbackRate = 1): Promise<void> {
  if (seq !== requestSeq || controller.signal.aborted) return Promise.resolve();

  stopCurrent();

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.playbackRate = playbackRate;
  currentAudio = audio;
  currentUrl = url;

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      controller.signal.removeEventListener("abort", onAbort);
      if (currentAudio === audio) stopCurrent();
      if (error) reject(error);
      else resolve();
    };

    const onAbort = () => finish();
    controller.signal.addEventListener("abort", onAbort, { once: true });

    audio.addEventListener("ended", () => finish(), { once: true });
    audio.addEventListener(
      "error",
      () => {
        if (seq !== requestSeq || controller.signal.aborted) {
          finish();
          return;
        }
        finish(new Error("Fallo la reproduccion del audio neural"));
      },
      { once: true }
    );

    void audio.play().catch((error: unknown) => {
      if (seq !== requestSeq || controller.signal.aborted) {
        finish();
        return;
      }
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

// Pre-sintetiza y cachea el audio (best-effort) SIN reproducirlo, para que la reproduccion
// posterior sea instantanea. Usa su propia peticion: no interfiere con la narracion en curso.
export async function prefetchNeural(
  text: string,
  engine: NeuralEngine,
  options: NeuralSpeechOptions = {}
): Promise<void> {
  const request: NeuralSpeechRequest = { text, voice: options.voice };
  const key = cacheKey(engine, request.text, request.voice);
  if (blobCache.has(key) || inFlightPrefetch.has(key)) return;

  const pending = requestNeuralBlob(request, engine, AbortSignal.timeout(SYNTH_TIMEOUT_MS))
    .then((blob) => {
      rememberBlob(key, blob);
      return blob;
    })
    .catch(() => null)
    .finally(() => {
      if (inFlightPrefetch.get(key) === pending) {
        inFlightPrefetch.delete(key);
      }
    });

  inFlightPrefetch.set(key, pending);
  await pending;
}

// Sintetiza y reproduce. Lanza SOLO ante un fallo real (motor no disponible, error de red,
// timeout o fallo de reproduccion) para que el orquestador caiga al respaldo del navegador.
// Si una narracion mas reciente la supera (o se cancela), termina en silencio sin respaldo.
export async function speakNeural(
  text: string,
  engine: NeuralEngine,
  options: NeuralSpeechOptions = {}
): Promise<void> {
  const seq = ++requestSeq;
  activeController?.abort(); // cancela la peticion anterior en vuelo
  const controller = new AbortController();
  activeController = controller;
  const request: NeuralSpeechRequest = { text, voice: options.voice };
  const blob = await obtainBlob(request, engine, controller, seq);
  if (!blob) return;
  await playBlob(blob, controller, seq, options.playbackRate ?? 1);
}

export async function speakNeuralSequence(
  requests: Array<NeuralSpeechRequest & { playbackRate?: number }>,
  engine: NeuralEngine
): Promise<void> {
  const seq = ++requestSeq;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;

  for (const request of requests) {
    if (seq !== requestSeq || controller.signal.aborted) return;
    const blob = await obtainBlob(request, engine, controller, seq);
    if (!blob) return;
    await playBlob(blob, controller, seq, request.playbackRate ?? 1);
  }
}
