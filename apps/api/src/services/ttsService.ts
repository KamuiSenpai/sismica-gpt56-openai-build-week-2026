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

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(env.ttsMaxTextLength),
  // Etiqueta opaca de voz/locutor: se usa para el cache y se reenvia a XTTS. Piper usa su
  // modelo configurado (no se acepta una ruta arbitraria del cliente por seguridad).
  voice: z.string().trim().min(1).max(120).optional()
});
export type TtsRequest = z.infer<typeof ttsRequestSchema>;

export type EngineHealth = { ok: boolean; voice?: string; detail?: string; profiles?: string[] };
export type TtsHealth = {
  enabled: boolean;
  engines: Record<TtsEngine, EngineHealth>;
};

export type TtsResult = { audio: Buffer; contentType: "audio/wav"; cached: boolean };

// Error de "motor no disponible" -> el endpoint responde 503 y el front cae al respaldo.
export class TtsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsUnavailableError";
  }
}

const PIPER_TIMEOUT_MS = 20_000;
const XTTS_TIMEOUT_MS = 120_000;
const XTTS_HEALTH_TIMEOUT_MS = 1_500;
const XTTS_HEALTH_TTL_MS = 10_000;

// Cache en memoria de audios sintetizados (las narraciones repiten frases).
const audioCache = new LRUCache<string, Buffer>({ max: 200 });
let cacheDirReady: Promise<void> | null = null;

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
      signal: AbortSignal.timeout(XTTS_TIMEOUT_MS)
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

export async function synthesize(engine: TtsEngine, request: TtsRequest): Promise<TtsResult> {
  if (!env.ttsEnabled) throw new TtsUnavailableError("TTS neural deshabilitado (TTS_ENABLED=false)");

  const voice = effectiveVoice(engine, request.voice);
  const key = cacheKey(engine, voice, request.text);

  const memoryHit = audioCache.get(key);
  if (memoryHit) return { audio: memoryHit, contentType: "audio/wav", cached: true };

  const diskHit = await readDiskCache(key);
  if (diskHit) {
    audioCache.set(key, diskHit);
    return { audio: diskHit, contentType: "audio/wav", cached: true };
  }

  const audio =
    engine === "piper"
      ? await synthesizePiper(request.text)
      : engine === "chatterbox"
        ? await synthesizeChatterbox(request.text, request.voice)
        : await synthesizeXtts(request.text, request.voice);

  audioCache.set(key, audio);
  await writeDiskCache(key, audio);
  return { audio, contentType: "audio/wav", cached: false };
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
        speaker?: string | null;
        defaultProfile?: string | null;
        profiles?: string[] | null;
      };
      value = {
        ok: true,
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
        speaker?: string | null;
        defaultProfile?: string | null;
        profiles?: string[] | null;
      };
      value = {
        ok: true,
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
