import { env } from "../config/env.js";

const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;

type FetchHeaderMap = Record<string, string>;

async function fetchResponse(url: string, accept: string, headers?: FetchHeaderMap): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "Plataforma-Visualizacion-Sismica/1.0",
      ...headers
    },
    signal: AbortSignal.timeout(env.sourceTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Source request failed: ${response.status} ${response.statusText}`);
  }

  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }

  return response;
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

export async function fetchText(url: string): Promise<string> {
  const response = await fetchResponse(url, "text/plain");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return text;
}

export async function fetchXml(url: string): Promise<string> {
  const response = await fetchResponse(url, "application/cap+xml, application/xml, text/xml;q=0.9");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return text;
}
