import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LRUCache } from "lru-cache";
import { z } from "zod";

import { env } from "../config/env.js";

// Las rutas de assets en .env se interpretan relativas a la raiz del repo (donde vive .env),
// no al cwd del proceso (apps/api). Las rutas absolutas se usan tal cual.
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
function resolveAsset(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(REPO_ROOT, pathValue);
}
const resolvedPiperBinary = env.piperBinaryPath ? resolveAsset(env.piperBinaryPath) : undefined;
const resolvedPiperVoice = env.piperVoiceModel ? resolveAsset(env.piperVoiceModel) : undefined;
const resolvedCacheDir = env.ttsCacheDir ? resolveAsset(env.ttsCacheDir) : undefined;

// Motores de sintesis disponibles: Piper (binario local) y XTTS-v2 (microservicio Python).
export const ttsEngineSchema = z.enum(["piper", "xtts", "chatterbox"]);
export type TtsEngine = z.infer<typeof ttsEngineSchema>;
export const voiceEngineSchema = z.enum(["browser", "piper", "xtts", "chatterbox"]);
export type VoiceEngine = z.infer<typeof voiceEngineSchema>;

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(env.ttsMaxTextLength),
  // Etiqueta opaca de voz/locutor: se usa para el cache y se reenvia a XTTS. Piper usa su
  // modelo configurado (no se acepta una ruta arbitraria del cliente por seguridad).
  voice: z.string().trim().min(1).max(120).optional()
});
export type TtsRequest = z.infer<typeof ttsRequestSchema>;

export type EngineHealth = {
  ok: boolean;
  loaded?: boolean;
  device?: string;
  voice?: string;
  detail?: string;
  profiles?: string[];
};
export type TtsHealth = {
  enabled: boolean;
  engines: Record<TtsEngine, EngineHealth>;
};

export type TtsResult = { audio: Buffer; contentType: "audio/wav"; cached: boolean };
export type TtsRuntimeStats = {
  active: boolean;
  activeForMs: number | null;
  activeVoice: string | null;
  started: number;
  completed: number;
  failed: number;
  busyRejected: number;
  cacheHits: number;
  sharedRequests: number;
  lastDurationMs: number | null;
  lastCompletedAt: string | null;
};

// Error de "motor no disponible" -> el endpoint responde 503 y el front cae al respaldo.
export class TtsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsUnavailableError";
  }
}

export class TtsBusyError extends Error {
  constructor(message = "Chatterbox ya esta generando otra locucion") {
    super(message);
    this.name = "TtsBusyError";
  }
}

const PIPER_TIMEOUT_MS = 20_000;
const XTTS_TIMEOUT_MS = 120_000;
const CHATTERBOX_TIMEOUT_MS = 240_000;
const XTTS_HEALTH_TIMEOUT_MS = 1_500;
const XTTS_HEALTH_TTL_MS = 10_000;

// Cache en memoria de audios sintetizados (las narraciones repiten frases).
const audioCache = new LRUCache<string, Buffer>({ max: 200 });
const inFlightSynthesis = new Map<string, Promise<Buffer>>();
let activeChatterboxKey: string | null = null;
let activeChatterboxStartedAt: number | null = null;
const chatterboxRuntime = {
  activeVoice: null as string | null,
  started: 0,
  completed: 0,
  failed: 0,
  busyRejected: 0,
  cacheHits: 0,
  sharedRequests: 0,
  lastDurationMs: null as number | null,
  lastCompletedAt: null as string | null
};
let cacheDirReady: Promise<void> | null = null;

export function getTtsRuntimeStats(): TtsRuntimeStats {
  return {
    active: activeChatterboxKey !== null,
    activeForMs:
      activeChatterboxStartedAt === null ? null : Math.max(0, Date.now() - activeChatterboxStartedAt),
    ...chatterboxRuntime
  };
}

function piperVoiceLabel(): string | undefined {
  return resolvedPiperVoice ? basename(resolvedPiperVoice).replace(/\.onnx$/i, "") : undefined;
}

function effectiveVoice(engine: TtsEngine, requested?: string): string {
  if (engine === "piper") return piperVoiceLabel() ?? "default";
  return requested ?? "default";
}

function cacheKey(engine: TtsEngine, voice: string, text: string): string {
  return createHash("sha256").update(`${engine}|${voice}|${text}`).digest("hex");
}

export function normalizeTextForTtsEngine(engine: TtsEngine, text: string): string {
  const sourceText =
    engine === "chatterbox" ? text : text.replace(/(\d)\.(\d)/g, "$1 punto $2").replace(/\./g, ",");

  const compactText = sourceText
    .replace(/\s*[\r\n]+\s*/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/([,;:!?])(?=\S)/gu, "$1 ")
    .replace(/(?<!\d)\.(?=\S)/gu, ". ")
    .replace(/(?<=\d)\.(?!\d)(?=\S)/gu, ". ")
    .replace(/\s{2,}/gu, " ")
    .trim();

  if (engine === "chatterbox") {
    return /[.!?]$/u.test(compactText) ? compactText : `${compactText}.`;
  }

  return compactText;
}

async function ensureCacheDir(dir: string): Promise<void> {
  if (!cacheDirReady) cacheDirReady = mkdir(dir, { recursive: true }).then(() => undefined);
  await cacheDirReady;
}

async function readDiskCache(key: string): Promise<Buffer | null> {
  if (!resolvedCacheDir) return null;
  const filePath = join(resolvedCacheDir, `${key}.wav`);
  if (!existsSync(filePath)) return null;
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

async function writeDiskCache(key: string, audio: Buffer): Promise<void> {
  if (!resolvedCacheDir) return;
  try {
    await ensureCacheDir(resolvedCacheDir);
    await writeFile(join(resolvedCacheDir, `${key}.wav`), audio);
  } catch {
    // El cache en disco es best-effort; un fallo no debe romper la sintesis.
  }
}

// Lanza el binario Piper: recibe el texto por stdin y escribe un WAV en outPath.
function runPiper(text: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const binary = resolvedPiperBinary as string;
    const args = ["-m", resolvedPiperVoice as string, "-f", outPath];
    if (env.piperUseCuda) args.push("--cuda");

    const child = spawn(binary, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`piper timed out after ${PIPER_TIMEOUT_MS}ms`));
    }, PIPER_TIMEOUT_MS);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`piper exited with code ${code}: ${stderr.trim()}`));
    });

    child.stdin?.write(`${text}\n`);
    child.stdin?.end();
  });
}

async function synthesizePiper(text: string): Promise<Buffer> {
  if (!resolvedPiperBinary || !resolvedPiperVoice) {
    throw new TtsUnavailableError("Piper no esta configurado (PIPER_BINARY_PATH / PIPER_VOICE_MODEL)");
  }
  if (!existsSync(resolvedPiperBinary) || !existsSync(resolvedPiperVoice)) {
    throw new TtsUnavailableError("Binario o modelo de Piper no encontrado en disco");
  }

  const outPath = join(tmpdir(), `piper-${createHash("sha1").update(text).digest("hex")}.wav`);
  try {
    await runPiper(text, outPath);
    return await readFile(outPath);
  } finally {
    await unlink(outPath).catch(() => undefined);
  }
}

async function synthesizeXtts(text: string, voice?: string): Promise<Buffer> {
  if (!env.xttsEnabled) {
    throw new TtsUnavailableError("XTTS-v2 esta deshabilitado");
  }
  if (!env.xttsServiceUrl) {
    throw new TtsUnavailableError("XTTS no esta configurado (XTTS_SERVICE_URL)");
  }
  let response: Response;
  try {
    response = await fetch(`${env.xttsServiceUrl}/synthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, speaker: voice }),
      signal: AbortSignal.timeout(XTTS_TIMEOUT_MS)
    });
  } catch (error) {
    throw new TtsUnavailableError(
      `No se pudo contactar el servicio XTTS: ${error instanceof Error ? error.message : "error"}`
    );
  }
  if (!response.ok) {
    throw new TtsUnavailableError(`Servicio XTTS respondio ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeChatterbox(text: string, voice?: string): Promise<Buffer> {
  if (!env.chatterboxServiceUrl) {
    throw new TtsUnavailableError("Chatterbox no esta configurado (CHATTERBOX_SERVICE_URL)");
  }
  let response: Response;
  try {
    response = await fetch(`${env.chatterboxServiceUrl}/synthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, speaker: voice }),
      signal: AbortSignal.timeout(CHATTERBOX_TIMEOUT_MS)
    });
  } catch (error) {
    throw new TtsUnavailableError(
      `No se pudo contactar el servicio Chatterbox: ${error instanceof Error ? error.message : "error"}`
    );
  }
  if (!response.ok) {
    throw new TtsUnavailableError(`Servicio Chatterbox respondio ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

const UNLOAD_TIMEOUT_MS = 15_000;
const LOAD_TIMEOUT_MS = 300_000;

function neuralServiceUrl(engine: TtsEngine): string | undefined {
  if (engine === "xtts") return env.xttsEnabled ? env.xttsServiceUrl : undefined;
  if (engine === "chatterbox") return env.chatterboxServiceUrl;
  return undefined;
}

// Exclusion mutua de VRAM: solo un motor neural (XTTS o Chatterbox) en GPU a la vez. Antes de
// sintetizar con uno, descarga el/los otro(s) para liberar memoria. Best-effort e idempotente:
// si el otro ya esta descargado, su /unload es un no-op rapido.
async function unloadOtherNeuralEngines(active: TtsEngine): Promise<void> {
  const others = (["xtts", "chatterbox"] as const).filter((engine) => engine !== active);
  await Promise.allSettled(
    others.map((engine) => {
      const url = neuralServiceUrl(engine);
      if (!url) return Promise.resolve();
      return fetch(`${url}/unload`, {
        method: "POST",
        signal: AbortSignal.timeout(UNLOAD_TIMEOUT_MS)
      }).catch(() => undefined);
    })
  );
}

function clearNeuralHealthCache(): void {
  xttsHealthCache = null;
  chatterboxHealthCache = null;
}

async function requestNeuralState(engine: "xtts" | "chatterbox", action: "load" | "unload"): Promise<void> {
  const url = neuralServiceUrl(engine);
  if (!url) {
    throw new TtsUnavailableError(`${engine} no esta configurado`);
  }
  let response: Response;
  try {
    response = await fetch(`${url}/${action}`, {
      method: "POST",
      signal: AbortSignal.timeout(action === "load" ? LOAD_TIMEOUT_MS : UNLOAD_TIMEOUT_MS)
    });
  } catch (error) {
    throw new TtsUnavailableError(
      `No se pudo ${action === "load" ? "cargar" : "descargar"} ${engine}: ${
        error instanceof Error ? error.message : "error"
      }`
    );
  }
  if (!response.ok) {
    throw new TtsUnavailableError(`${engine} respondio ${response.status} al intentar ${action}`);
  }
}

export async function activateVoiceEngine(engine: VoiceEngine): Promise<TtsHealth> {
  if (!env.ttsEnabled && engine !== "browser") {
    throw new TtsUnavailableError("TTS neural deshabilitado (TTS_ENABLED=false)");
  }
  if (engine === "xtts" && !env.xttsEnabled) {
    throw new TtsUnavailableError("XTTS-v2 esta deshabilitado; use Chatterbox");
  }

  if (engine === "xtts" || engine === "chatterbox") {
    await requestNeuralState(engine === "xtts" ? "chatterbox" : "xtts", "unload").catch(() => undefined);
    await requestNeuralState(engine, "load");
  } else {
    await Promise.allSettled([
      requestNeuralState("xtts", "unload"),
      requestNeuralState("chatterbox", "unload")
    ]);
  }

  clearNeuralHealthCache();
  return getHealth();
}

export async function synthesize(engine: TtsEngine, request: TtsRequest): Promise<TtsResult> {
  if (!env.ttsEnabled) throw new TtsUnavailableError("TTS neural deshabilitado (TTS_ENABLED=false)");
  if (engine === "xtts" && !env.xttsEnabled) {
    throw new TtsUnavailableError("XTTS-v2 esta deshabilitado; use Chatterbox");
  }

  const voice = effectiveVoice(engine, request.voice);

  // Chatterbox conserva puntuacion real; Piper/XTTS siguen usando comas como pausas seguras.
  const spokenText = normalizeTextForTtsEngine(engine, request.text);

  const key = cacheKey(engine, voice, spokenText);

  const memoryHit = audioCache.get(key);
  if (memoryHit) {
    if (engine === "chatterbox") chatterboxRuntime.cacheHits += 1;
    return { audio: memoryHit, contentType: "audio/wav", cached: true };
  }

  const diskHit = await readDiskCache(key);
  if (diskHit) {
    audioCache.set(key, diskHit);
    if (engine === "chatterbox") chatterboxRuntime.cacheHits += 1;
    return { audio: diskHit, contentType: "audio/wav", cached: true };
  }

  const sharedSynthesis = inFlightSynthesis.get(key);
  if (sharedSynthesis) {
    if (engine === "chatterbox") chatterboxRuntime.sharedRequests += 1;
    return {
      audio: await sharedSynthesis,
      contentType: "audio/wav",
      cached: false
    };
  }

  // Chatterbox genera de forma serial. Rechazar otra locucion distinta evita que varias
  // peticiones HTTP queden esperando el mismo lock de Python durante minutos.
  if (engine === "chatterbox" && activeChatterboxKey && activeChatterboxKey !== key) {
    chatterboxRuntime.busyRejected += 1;
    throw new TtsBusyError();
  }

  const pending = (async () => {
    if (engine === "xtts" || engine === "chatterbox") {
      await unloadOtherNeuralEngines(engine);
    }

    const audio =
      engine === "piper"
        ? await synthesizePiper(spokenText)
        : engine === "chatterbox"
          ? await synthesizeChatterbox(spokenText, request.voice)
          : await synthesizeXtts(spokenText, request.voice);

    audioCache.set(key, audio);
    await writeDiskCache(key, audio);
    return audio;
  })();

  inFlightSynthesis.set(key, pending);
  if (engine === "chatterbox") {
    activeChatterboxKey = key;
    activeChatterboxStartedAt = Date.now();
    chatterboxRuntime.activeVoice = voice;
    chatterboxRuntime.started += 1;
  }
  try {
    const audio = await pending;
    if (engine === "chatterbox") {
      chatterboxRuntime.completed += 1;
      chatterboxRuntime.lastCompletedAt = new Date().toISOString();
    }
    return { audio, contentType: "audio/wav", cached: false };
  } catch (error) {
    if (engine === "chatterbox") chatterboxRuntime.failed += 1;
    throw error;
  } finally {
    if (inFlightSynthesis.get(key) === pending) inFlightSynthesis.delete(key);
    if (activeChatterboxKey === key) {
      chatterboxRuntime.lastDurationMs =
        activeChatterboxStartedAt === null ? null : Date.now() - activeChatterboxStartedAt;
      activeChatterboxKey = null;
      activeChatterboxStartedAt = null;
      chatterboxRuntime.activeVoice = null;
    }
  }
}

function piperHealth(): EngineHealth {
  if (!resolvedPiperBinary || !resolvedPiperVoice) {
    return { ok: false, detail: "PIPER_BINARY_PATH / PIPER_VOICE_MODEL sin configurar" };
  }
  if (!existsSync(resolvedPiperBinary) || !existsSync(resolvedPiperVoice)) {
    return { ok: false, detail: "binario o modelo no encontrado en disco" };
  }
  return { ok: true, voice: piperVoiceLabel() };
}

let xttsHealthCache: { at: number; value: EngineHealth } | null = null;

async function xttsHealth(): Promise<EngineHealth> {
  if (!env.xttsEnabled) {
    return { ok: false, loaded: false, detail: "deshabilitado por configuracion" };
  }
  if (!env.xttsServiceUrl) return { ok: false, detail: "XTTS_SERVICE_URL sin configurar" };
  if (xttsHealthCache && Date.now() - xttsHealthCache.at < XTTS_HEALTH_TTL_MS) {
    return xttsHealthCache.value;
  }
  let value: EngineHealth;
  try {
    const response = await fetch(`${env.xttsServiceUrl}/health`, {
      signal: AbortSignal.timeout(XTTS_HEALTH_TIMEOUT_MS)
    });
    if (!response.ok) {
      value = { ok: false, detail: `health ${response.status}` };
    } else {
      const payload = (await response.json()) as {
        loaded?: boolean;
        device?: string;
        speaker?: string | null;
        defaultProfile?: string | null;
        profiles?: string[] | null;
      };
      value = {
        ok: true,
        loaded: payload.loaded === true,
        device: payload.device,
        voice: payload.defaultProfile ?? payload.speaker ?? "xtts-v2",
        profiles: Array.isArray(payload.profiles)
          ? payload.profiles.filter((item) => typeof item === "string")
          : []
      };
    }
  } catch {
    value = { ok: false, detail: "servicio no accesible" };
  }
  xttsHealthCache = { at: Date.now(), value };
  return value;
}

let chatterboxHealthCache: { at: number; value: EngineHealth } | null = null;

async function chatterboxHealth(): Promise<EngineHealth> {
  if (!env.chatterboxServiceUrl) return { ok: false, detail: "CHATTERBOX_SERVICE_URL sin configurar" };
  if (chatterboxHealthCache && Date.now() - chatterboxHealthCache.at < XTTS_HEALTH_TTL_MS) {
    return chatterboxHealthCache.value;
  }
  let value: EngineHealth;
  try {
    const response = await fetch(`${env.chatterboxServiceUrl}/health`, {
      signal: AbortSignal.timeout(XTTS_HEALTH_TIMEOUT_MS)
    });
    if (!response.ok) {
      value = { ok: false, detail: `health ${response.status}` };
    } else {
      const payload = (await response.json()) as {
        loaded?: boolean;
        device?: string;
        speaker?: string | null;
        defaultProfile?: string | null;
        profiles?: string[] | null;
      };
      value = {
        ok: true,
        loaded: payload.loaded === true,
        device: payload.device,
        voice: payload.defaultProfile ?? payload.speaker ?? "chatterbox",
        profiles: Array.isArray(payload.profiles)
          ? payload.profiles.filter((item) => typeof item === "string")
          : []
      };
    }
  } catch {
    value = { ok: false, detail: "servicio no accesible" };
  }
  chatterboxHealthCache = { at: Date.now(), value };
  return value;
}

export async function getHealth(): Promise<TtsHealth> {
  if (!env.ttsEnabled) {
    return {
      enabled: false,
      engines: {
        piper: { ok: false, detail: "TTS_ENABLED=false" },
        xtts: { ok: false, detail: "TTS_ENABLED=false" },
        chatterbox: { ok: false, detail: "TTS_ENABLED=false" }
      }
    };
  }
  const [piper, xtts, chatterbox] = [piperHealth(), await xttsHealth(), await chatterboxHealth()];
  return { enabled: true, engines: { piper, xtts, chatterbox } };
}
