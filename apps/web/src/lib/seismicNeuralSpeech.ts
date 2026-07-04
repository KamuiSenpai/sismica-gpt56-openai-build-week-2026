// Capa de voz neural: pide el audio al API (/api/tts) y lo reproduce en el navegador.
// El API enruta a Piper (binario local) o hace proxy a XTTS-v2 (servicio Python).

export type NeuralEngine = "piper" | "xtts" | "chatterbox";
export type NeuralSpeechOptions = { voice?: string; playbackRate?: number };
export type NeuralSpeechRequest = { text: string; voice?: string };

export type TtsEngineHealth = {
  ok: boolean;
  loaded?: boolean;
  device?: string;
  voice?: string;
  detail?: string;
  profiles?: string[];
};
export type TtsHealth = {
  enabled: boolean;
  engines: Record<NeuralEngine, TtsEngineHealth>;
};

const API_BASE_URL =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ??
  "http://localhost:3000";
const SYNTH_TIMEOUT_MS = 120_000;
const ENGINE_SWITCH_TIMEOUT_MS = 300_000;
const PREFETCH_CACHE_LIMIT = 8;
const ABORTED_PENDING_BLOB = Symbol("aborted-pending-blob");
type PendingBlobRequest = {
  controller: AbortController;
  consumers: Set<symbol>;
  promise: Promise<Blob>;
};

// Cache de audios ya sintetizados (Blob) para reproducir sin ida y vuelta a la red.
const blobCache = new Map<string, Blob>();
const inFlightBlobRequests = new Map<string, PendingBlobRequest>();

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

function startSharedBlobRequest(request: NeuralSpeechRequest, engine: NeuralEngine): PendingBlobRequest {
  const key = cacheKey(engine, request.text, request.voice);
  const existing = inFlightBlobRequests.get(key);
  if (existing) return existing;

  const controller = new AbortController();
  const pending = {
    controller,
    consumers: new Set<symbol>(),
    promise: Promise.resolve<Blob>(null as never)
  } satisfies PendingBlobRequest;

  pending.promise = requestNeuralBlob(
    request,
    engine,
    AbortSignal.any([controller.signal, AbortSignal.timeout(SYNTH_TIMEOUT_MS)])
  )
    .then((blob) => {
      rememberBlob(key, blob);
      return blob;
    })
    .finally(() => {
      if (inFlightBlobRequests.get(key) === pending) {
        inFlightBlobRequests.delete(key);
      }
    });

  inFlightBlobRequests.set(key, pending);
  return pending;
}

function releaseBlobConsumer(key: string, pending: PendingBlobRequest, token: symbol): void {
  pending.consumers.delete(token);
  if (pending.consumers.size === 0 && inFlightBlobRequests.get(key) === pending) {
    pending.controller.abort();
  }
}

async function awaitBlobRequest(key: string, pending: PendingBlobRequest): Promise<Blob> {
  const token = Symbol(key);
  pending.consumers.add(token);
  try {
    return await pending.promise;
  } finally {
    releaseBlobConsumer(key, pending, token);
  }
}

async function waitForBlobRequest(
  key: string,
  pending: PendingBlobRequest,
  signal: AbortSignal
): Promise<Blob | typeof ABORTED_PENDING_BLOB> {
  if (signal.aborted) return ABORTED_PENDING_BLOB;
  const token = Symbol(key);
  pending.consumers.add(token);
  return await new Promise<Blob | typeof ABORTED_PENDING_BLOB>((resolve, reject) => {
    let settled = false;

    const finish = (value?: Blob | typeof ABORTED_PENDING_BLOB, error?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      releaseBlobConsumer(key, pending, token);
      if (error !== undefined) reject(error);
      else resolve(value ?? ABORTED_PENDING_BLOB);
    };

    const onAbort = () => {
      finish(ABORTED_PENDING_BLOB);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    void pending.promise.then(
      (blob) => {
        finish(blob);
      },
      (error) => {
        finish(undefined, error);
      }
    );
  });
}

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
// Secuencia de peticiones: una narracion mas reciente invalida a las anteriores, para que
// XTTS (aun siendo lento) no se reproduzca ni caiga al respaldo cuando ya fue superada.
let activeController: AbortController | null = null;
let activeRequestKey: string | null = null;
let activePlaybackPromise: Promise<void> | null = null;
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
  activeRequestKey = null;
  activePlaybackPromise = null;
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

export async function activateTtsEngine(
  engine: NeuralEngine | "browser",
  signal?: AbortSignal
): Promise<TtsHealth> {
  const timeoutSignal = AbortSignal.timeout(ENGINE_SWITCH_TIMEOUT_MS);
  const response = await fetch(`${API_BASE_URL}/api/tts/engine`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engine }),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  });
  const payload = (await response.json().catch(() => null)) as { error?: string; health?: TtsHealth } | null;
  if (!response.ok || !payload?.health) {
    throw new Error(payload?.error ?? `No se pudo activar ${engine}`);
  }
  return payload.health;
}

async function obtainBlob(
  request: NeuralSpeechRequest,
  engine: NeuralEngine,
  controller: AbortController,
  seq: number
): Promise<Blob | null> {
  const key = cacheKey(engine, request.text, request.voice);
  let blob = blobCache.get(key) ?? null;

  if (!blob) {
    try {
      const result = await waitForBlobRequest(
        key,
        startSharedBlobRequest(request, engine),
        controller.signal
      );
      if (result === ABORTED_PENDING_BLOB) return null;
      blob = result;
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
  if (blobCache.has(key)) return;
  // Chatterbox sintetiza de a una; no conviene abrir otra prefetch distinta mientras el
  // motor sigue ocupado porque solo apila trabajo especulativo y aumenta los timeouts.
  if (!inFlightBlobRequests.has(key) && inFlightBlobRequests.size > 0) return;
  await awaitBlobRequest(key, startSharedBlobRequest(request, engine)).catch(() => undefined);
}

// Sintetiza y reproduce. Lanza SOLO ante un fallo real (motor no disponible, error de red,
// timeout o fallo de reproduccion) para que el orquestador caiga al respaldo del navegador.
// Si una narracion mas reciente la supera (o se cancela), termina en silencio sin respaldo.
export async function speakNeural(
  text: string,
  engine: NeuralEngine,
  options: NeuralSpeechOptions = {}
): Promise<void> {
  const request: NeuralSpeechRequest = { text, voice: options.voice };
  const key = cacheKey(engine, request.text, request.voice);
  if (activeRequestKey === key && activePlaybackPromise) return activePlaybackPromise;

  const seq = ++requestSeq;
  activeController?.abort(); // cancela la peticion anterior en vuelo
  const controller = new AbortController();
  activeController = controller;
  activeRequestKey = key;

  const playback = (async () => {
    const blob = await obtainBlob(request, engine, controller, seq);
    if (!blob) return;
    await playBlob(blob, controller, seq, options.playbackRate ?? 1);
  })().finally(() => {
    if (activePlaybackPromise === playback) {
      activePlaybackPromise = null;
    }
    if (activeRequestKey === key) {
      activeRequestKey = null;
    }
    if (activeController === controller) {
      activeController = null;
    }
  });

  activePlaybackPromise = playback;
  return playback;
}

export async function speakNeuralSequence(
  requests: Array<NeuralSpeechRequest & { playbackRate?: number }>,
  engine: NeuralEngine
): Promise<void> {
  const seq = ++requestSeq;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  activeRequestKey = null;

  const playback = (async () => {
    for (const request of requests) {
      if (seq !== requestSeq || controller.signal.aborted) return;
      const blob = await obtainBlob(request, engine, controller, seq);
      if (!blob) return;
      await playBlob(blob, controller, seq, request.playbackRate ?? 1);
    }
  })().finally(() => {
    if (activePlaybackPromise === playback) {
      activePlaybackPromise = null;
    }
    if (activeController === controller) {
      activeController = null;
    }
  });

  activePlaybackPromise = playback;
  return playback;
}
