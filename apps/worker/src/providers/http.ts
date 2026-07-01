import { get as httpsGet } from "node:https";

import { env } from "../config/env.js";

const decoder = new TextDecoder();

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
  const response = await fetchResponse(url, "text/html, text/plain, text/csv;q=0.9, */*;q=0.5");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return text;
}

export async function fetchTextAllowInvalidTls(url: string): Promise<string> {
  return await new Promise((resolve, reject) => {
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

export async function fetchXml(url: string): Promise<string> {
  const response = await fetchResponse(url, "application/cap+xml, application/xml, text/xml;q=0.9");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Source response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return text;
}
