import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TtsBridgeLibrary = "short" | "extended" | "station";

type RawBridgeManifest = {
  version?: string;
  catalogVersion?: string;
  generatedAtUtc?: string;
  voices?: unknown;
  groups?: unknown;
  items?: unknown;
};

type RawBridgeGroup = {
  id?: unknown;
  kind?: unknown;
  status?: unknown;
};

type RawBridgeItem = {
  voice?: unknown;
  groupId?: unknown;
  variant?: unknown;
  text?: unknown;
  outputPath?: unknown;
  bytes?: unknown;
  keywords?: unknown;
};

export type TtsBridgeManifestItem = {
  voice: string;
  groupId: string;
  variant: string;
  text: string;
  bytes: number | null;
  path: string;
  keywords: string[];
};

export type TtsBridgeManifestGroup = {
  id: string;
  kind: string | null;
  status: string | null;
  variants: number;
};

export type TtsBridgeManifest = {
  library: TtsBridgeLibrary;
  version: string | null;
  generatedAtUtc: string | null;
  voices: string[];
  groups: TtsBridgeManifestGroup[];
  items: TtsBridgeManifestItem[];
};

type CachedBridgeLibrary = {
  manifest: TtsBridgeManifest;
  files: Map<string, string>;
};

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BRIDGE_LIBRARY_ROOTS: Record<TtsBridgeLibrary, string> = {
  short: join(REPO_ROOT, "Grabaciones", "contexto-pregabado"),
  extended: join(REPO_ROOT, "Grabaciones", "contexto-extendido"),
  station: join(REPO_ROOT, "Grabaciones", "pautas-informativas")
};
const manifestCache = new Map<TtsBridgeLibrary, Promise<CachedBridgeLibrary | null>>();

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function normalizedPath(value: string): string {
  return resolve(value).replace(/\\/g, "/").toLowerCase();
}

function fileKey(voice: string, fileName: string): string {
  return `${voice}/${fileName}`.toLowerCase();
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function loadBridgeLibrary(library: TtsBridgeLibrary): Promise<CachedBridgeLibrary | null> {
  const cached = manifestCache.get(library);
  if (cached) return cached;

  const pending = (async (): Promise<CachedBridgeLibrary | null> => {
    const root = BRIDGE_LIBRARY_ROOTS[library];
    const manifestPath = join(root, "manifest-current.json");
    if (!existsSync(manifestPath)) return null;

    const parsed = JSON.parse(stripBom(await readFile(manifestPath, "utf8"))) as RawBridgeManifest;
    const rootKey = normalizedPath(root);
    const items: TtsBridgeManifestItem[] = [];
    const files = new Map<string, string>();
    const variantCounts = new Map<string, number>();

    for (const candidate of Array.isArray(parsed.items) ? parsed.items : []) {
      const item = candidate as RawBridgeItem;
      if (
        !isString(item.voice) ||
        !isString(item.groupId) ||
        !isString(item.variant) ||
        !isString(item.text) ||
        !isString(item.outputPath)
      ) {
        continue;
      }
      const outputPath = resolve(item.outputPath);
      if (!normalizedPath(outputPath).startsWith(`${rootKey}/`)) {
        continue;
      }
      const fileName = basename(outputPath);
      files.set(fileKey(item.voice, fileName), outputPath);
      items.push({
        voice: item.voice,
        groupId: item.groupId,
        variant: item.variant,
        text: item.text.trim(),
        bytes: typeof item.bytes === "number" && Number.isFinite(item.bytes) ? item.bytes : null,
        path: `/api/tts/bridges/${library}/${encodeURIComponent(item.voice)}/${encodeURIComponent(fileName)}`,
        keywords: Array.isArray(item.keywords)
          ? item.keywords
              .filter((keyword): keyword is string => isString(keyword))
              .map((keyword) => keyword.trim())
          : []
      });
      variantCounts.set(item.groupId, (variantCounts.get(item.groupId) ?? 0) + 1);
    }

    const groupsFromManifest = new Map<string, TtsBridgeManifestGroup>();
    for (const candidate of Array.isArray(parsed.groups) ? parsed.groups : []) {
      const group = candidate as RawBridgeGroup;
      if (!isString(group.id)) continue;
      groupsFromManifest.set(group.id, {
        id: group.id,
        kind: isString(group.kind) ? group.kind : null,
        status: isString(group.status) ? group.status : null,
        variants: variantCounts.get(group.id) ?? 0
      });
    }
    for (const item of items) {
      if (groupsFromManifest.has(item.groupId)) continue;
      groupsFromManifest.set(item.groupId, {
        id: item.groupId,
        kind: null,
        status: null,
        variants: variantCounts.get(item.groupId) ?? 0
      });
    }

    const voices = Array.isArray(parsed.voices)
      ? parsed.voices.filter((voice): voice is string => isString(voice))
      : Array.from(new Set(items.map((item) => item.voice))).sort((left, right) => left.localeCompare(right));

    return {
      manifest: {
        library,
        version:
          (isString(parsed.catalogVersion) ? parsed.catalogVersion : null) ??
          (isString(parsed.version) ? parsed.version : null),
        generatedAtUtc: isString(parsed.generatedAtUtc) ? parsed.generatedAtUtc : null,
        voices,
        groups: [...groupsFromManifest.values()].sort((left, right) => left.id.localeCompare(right.id)),
        items
      },
      files
    };
  })();

  manifestCache.set(library, pending);
  return pending;
}

export async function getTtsBridgeManifest(library: TtsBridgeLibrary): Promise<TtsBridgeManifest | null> {
  return (await loadBridgeLibrary(library))?.manifest ?? null;
}

export async function resolveTtsBridgeFile(
  library: TtsBridgeLibrary,
  voice: string,
  fileName: string
): Promise<string | null> {
  return (await loadBridgeLibrary(library))?.files.get(fileKey(voice, fileName)) ?? null;
}
