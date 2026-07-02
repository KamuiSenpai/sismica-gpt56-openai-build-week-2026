import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LRUCache } from "lru-cache";
import { z } from "zod";

import { env } from "../config/env.js";
import { chat, DeepSeekUnavailableError } from "./deepseekClient.js";

export const narrationRequestSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  magnitude: z.number().finite().nullish(),
  depthKm: z.number().finite().nullish(),
  tsunami: z.boolean().optional(),
  eventTimeUtc: z.string().trim().min(1).max(40).optional()
});
export type NarrationRequest = z.infer<typeof narrationRequestSchema>;

// Cache por evento: cada sismo se narra UNA sola vez; el recorrido reutiliza (control de coste).
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const cacheDir = env.ttsCacheDir
  ? join(isAbsolute(env.ttsCacheDir) ? env.ttsCacheDir : resolve(REPO_ROOT, env.ttsCacheDir), "narration")
  : null;

const memoryCache = new LRUCache<string, string>({ max: 500 });
let cacheDirReady: Promise<void> | null = null;

function cacheKey(eventId: string): string {
  return createHash("sha1").update(eventId).digest("hex");
}

async function readDiskCache(key: string): Promise<string | null> {
  if (!cacheDir) return null;
  const filePath = join(cacheDir, `${key}.txt`);
  if (!existsSync(filePath)) return null;
  try {
    return (await readFile(filePath, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

async function writeDiskCache(key: string, text: string): Promise<void> {
  if (!cacheDir) return;
  try {
    if (!cacheDirReady) cacheDirReady = mkdir(cacheDir, { recursive: true }).then(() => undefined);
    await cacheDirReady;
    await writeFile(join(cacheDir, `${key}.txt`), text, "utf8");
  } catch {
    // Cache en disco best-effort; un fallo no debe romper la narracion.
  }
}

// Tope de llamadas por ventana de 60 s: excederlo -> null (el cliente usa la plantilla).
let windowStart = 0;
let windowCount = 0;
function withinRateLimit(): boolean {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= env.deepseekRatePerMin) return false;
  windowCount += 1;
  return true;
}

const SYSTEM_PROMPT =
  "Eres el presentador de un canal de monitoreo sismico en directo 24/7. Redacta UNA narracion " +
  "breve (1 o 2 frases, maximo 35 palabras) en espanol neutro, natural y variada, lista para " +
  "locutar por voz. Usa solo los datos proporcionados; no inventes cifras. Sin emojis, sin " +
  "markdown y sin comillas.";

function buildUserMessage(request: NarrationRequest): string {
  const data: Record<string, unknown> = { titulo: request.title };
  if (typeof request.magnitude === "number") data.magnitud = request.magnitude;
  if (typeof request.depthKm === "number") data.profundidad_km = Math.round(request.depthKm);
  if (request.tsunami) data.tsunami = true;
  return `Datos del sismo: ${JSON.stringify(data)}`;
}

// Devuelve la narracion IA (cacheada) o null ante cualquier problema, para que el cliente
// use la plantilla local (buildSeismicNarration) que ya funciona.
export async function generateNarration(request: NarrationRequest): Promise<string | null> {
  if (!env.deepseekEnabled || !env.deepseekApiKey) return null;

  const key = cacheKey(request.eventId);
  const memoryHit = memoryCache.get(key);
  if (memoryHit) return memoryHit;

  const diskHit = await readDiskCache(key);
  if (diskHit) {
    memoryCache.set(key, diskHit);
    return diskHit;
  }

  if (!withinRateLimit()) return null;

  try {
    const raw = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(request) }
      ],
      { maxTokens: env.deepseekMaxTokens, temperature: 1.0 }
    );
    const text = raw.replace(/^["']+|["']+$/g, "").trim();
    if (!text) return null;
    memoryCache.set(key, text);
    await writeDiskCache(key, text);
    return text;
  } catch (error) {
    if (!(error instanceof DeepSeekUnavailableError)) {
      console.warn("Fallo generando narracion IA; se usara la plantilla.", error);
    }
    return null;
  }
}
