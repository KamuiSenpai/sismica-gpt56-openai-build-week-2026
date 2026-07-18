import { get as httpsGet } from "node:https";

import { env } from "../config/env.js";

const decoder = new TextDecoder();

const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const SOURCE_FETCH_ATTEMPTS = 2;
const SOURCE_RETRY_DELAY_MS = 350;

type FetchHeaderMap = Record<string, string>;

export function isRetryableSourceStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchResponse(url: string, accept: string, headers?: FetchHeaderMap): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SOURCE_FETCH_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: accept,
          "User-Agent": "Plataforma-Visualizacion-Sismica/1.0",
          ...headers
        },
        signal: AbortSignal.timeout(env.sourceTimeoutMs)
      });
    } catch (error) {
      lastError = error;
      if (attempt === SOURCE_FETCH_ATTEMPTS) throw error;
      await wait(SOURCE_RETRY_DELAY_MS * attempt);
      continue;
    }

    if (!response.ok) {
      const error = new Error(`Source request failed: ${response.status} ${response.statusText}`);
      lastError = error;
      if (attempt === SOURCE_FETCH_ATTEMPTS || !isRetryableSourceStatus(response.status)) {
        throw error;
      }
      await response.body?.cancel().catch(() => undefined);
      await wait(SOURCE_RETRY_DELAY_MS * attempt);
      continue;
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }

    return response;
  }

  throw lastError instanceof Error ? lastError : new Error("Source request failed");
}

export function parseOptionalJson<T>(text: string): T | null {
  return text.trim().length > 0 ? (JSON.parse(text) as T) : null;
}

export async function fetchJson<T>(
  url: string,
  accept = "application/json, application/geo+json;q=0.9",
  headers?: FetchHeaderMap
): Promise<T> {
  const response = await fetchResponse(url, accept, headers);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return JSON.parse(text) as T;
}

export async function fetchOptionalJson<T>(
  url: string,
  accept = "application/json, application/geo+json;q=0.9",
  headers?: FetchHeaderMap
): Promise<T | null> {
  const response = await fetchResponse(url, accept, headers);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return parseOptionalJson<T>(text);
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetchResponse(url, "text/html, text/plain, text/csv;q=0.9, */*;q=0.5");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return text;
}

function fetchTextAllowInvalidTlsOnce(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      {
        headers: {
          Accept: "text/html, text/plain;q=0.9",
          "User-Agent": "Plataforma-Visualizacion-Sismica/1.0"
        },
        rejectUnauthorized: false,
        timeout: env.sourceTimeoutMs
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Source request failed: ${status} ${response.statusMessage ?? ""}`.trim()));
          return;
        }

        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (declaredLength > MAX_RESPONSE_BYTES) {
          response.resume();
          reject(new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) {
            request.destroy(new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(decoder.decode(Buffer.concat(chunks))));
      }
    );
    request.on("timeout", () => request.destroy(new Error("Source request timed out")));
    request.on("error", reject);
  });
}

export async function fetchTextAllowInvalidTls(url: string): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SOURCE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchTextAllowInvalidTlsOnce(url);
    } catch (error) {
      lastError = error;
      const statusMatch = /Source request failed: (\d{3})/.exec(
        error instanceof Error ? error.message : String(error)
      );
      const status = statusMatch ? Number(statusMatch[1]) : null;
      if (attempt === SOURCE_FETCH_ATTEMPTS || (status !== null && !isRetryableSourceStatus(status))) {
        throw error;
      }
      await wait(SOURCE_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Source request failed");
}

export async function fetchXml(url: string): Promise<string> {
  const response = await fetchResponse(url, "application/cap+xml, application/xml, text/xml;q=0.9");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return text;
}
