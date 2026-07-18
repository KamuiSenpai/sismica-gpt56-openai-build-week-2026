import { existsSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TtsBridgeLibrary =
  | "short"
  | "extended"
  | "informative"
  | "educational"
  | "official-informative"
  | "official-educational"
  | "official-promotional";
export type TtsBridgeApprovalStatus = "pending" | "approved" | "rejected";

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
  classId?: unknown;
  playbackRole?: unknown;
  groupId?: unknown;
  variant?: unknown;
  text?: unknown;
  outputPath?: unknown;
  bytes?: unknown;
  durationMs?: unknown;
  approvalStatus?: unknown;
  keywords?: unknown;
};

export type TtsBridgeManifestItem = {
  voice: string;
  classId: string | null;
  playbackRole: string | null;
  groupId: string;
  variant: string;
  text: string;
  bytes: number | null;
  durationMs: number | null;
  approvalStatus: TtsBridgeApprovalStatus | null;
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

type CachedBridgeLibraryEntry = {
  manifestPath: string;
  manifestMtimeMs: number;
  pending: Promise<CachedBridgeLibrary | null>;
};

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BRIDGE_LIBRARY_ROOTS: Record<TtsBridgeLibrary, string> = {
  short: join(REPO_ROOT, "Grabaciones", "contexto-pregabado"),
  extended: join(REPO_ROOT, "Grabaciones", "contexto-extendido"),
  informative: join(REPO_ROOT, "Grabaciones", "pautas-informativas"),
  educational: join(REPO_ROOT, "Grabaciones", "pautas-educativas"),
  "official-informative": join(REPO_ROOT, "Grabaciones", "produccion", "pautas-informativas"),
  "official-educational": join(REPO_ROOT, "Grabaciones", "produccion", "pautas-educativas"),
  "official-promotional": join(REPO_ROOT, "Grabaciones", "produccion", "pautas-promocionales")
};
const manifestCache = new Map<TtsBridgeLibrary, CachedBridgeLibraryEntry>();

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function normalizedPath(value: string): string {
  return resolve(value).replace(/\\/g, "/").toLowerCase();
}

function resolveManifestOutputPath(root: string, value: string): string {
  const portablePath = value.replace(/\\/g, "/");
  const lowerPath = portablePath.toLowerCase();
  const recordingsMarker = "/grabaciones/";
  const markerIndex = lowerPath.indexOf(recordingsMarker);

  if (markerIndex >= 0) {
    const relativeToRepo = portablePath.slice(markerIndex + 1);
    return resolve(REPO_ROOT, ...relativeToRepo.split("/").filter(Boolean));
  }
  if (lowerPath.startsWith("grabaciones/")) {
    return resolve(REPO_ROOT, ...portablePath.split("/").filter(Boolean));
  }
  return resolve(root, ...portablePath.split("/").filter(Boolean));
}

function fileKey(voice: string, fileName: string): string {
  return `${voice}/${fileName}`.toLowerCase();
}

function fileNameKey(fileName: string): string {
  return fileName.toLowerCase();
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function approvalStatus(value: unknown): TtsBridgeApprovalStatus | null {
  return value === "pending" || value === "approved" || value === "rejected" ? value : null;
}

export function parsePcmWavDurationMs(buffer: Buffer): number | null {
  if (
    buffer.length < 12 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }

  let byteRate: number | null = null;
  let dataBytes: number | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    if (chunkId === "fmt " && chunkSize >= 16 && payloadOffset + 12 <= buffer.length) {
      const parsedByteRate = buffer.readUInt32LE(payloadOffset + 8);
      if (parsedByteRate > 0) byteRate = parsedByteRate;
    }
    if (chunkId === "data") {
      dataBytes = chunkSize;
      break;
    }
    const nextOffset = payloadOffset + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > buffer.length) break;
    offset = nextOffset;
  }

  if (!byteRate || dataBytes === null) return null;
  return Math.max(1, Math.round((dataBytes / byteRate) * 1000));
}

async function readWavDurationMs(filePath: string): Promise<number | null> {
  if (!existsSync(filePath)) return null;
  const handle = await open(filePath, "r");
  try {
    const file = await handle.stat();
    const header = Buffer.alloc(Math.min(file.size, 256 * 1024));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return parsePcmWavDurationMs(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function loadBridgeLibrary(library: TtsBridgeLibrary): Promise<CachedBridgeLibrary | null> {
  const root = BRIDGE_LIBRARY_ROOTS[library];
  const manifestPath = join(root, "manifest-current.json");
  if (!existsSync(manifestPath)) return null;

  const manifestMtimeMs = (await stat(manifestPath)).mtimeMs;
  const cached = manifestCache.get(library);
  if (cached && cached.manifestPath === manifestPath && cached.manifestMtimeMs === manifestMtimeMs) {
    return cached.pending;
  }

  const pending = (async (): Promise<CachedBridgeLibrary | null> => {
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
      const outputPath = resolveManifestOutputPath(root, item.outputPath);
      if (!normalizedPath(outputPath).startsWith(`${rootKey}/`)) {
        continue;
      }
      const fileName = basename(outputPath);
      const durationMs =
        typeof item.durationMs === "number" && Number.isFinite(item.durationMs) && item.durationMs > 0
          ? Math.round(item.durationMs)
          : await readWavDurationMs(outputPath).catch(() => null);
      files.set(fileKey(item.voice, fileName), outputPath);
      files.set(fileNameKey(fileName), outputPath);
      items.push({
        voice: item.voice,
        classId: isString(item.classId) ? item.classId.trim() : null,
        playbackRole: isString(item.playbackRole) ? item.playbackRole.trim() : null,
        groupId: item.groupId,
        variant: item.variant,
        text: item.text.trim(),
        bytes: typeof item.bytes === "number" && Number.isFinite(item.bytes) ? item.bytes : null,
        durationMs,
        approvalStatus: approvalStatus(item.approvalStatus),
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

  manifestCache.set(library, {
    manifestPath,
    manifestMtimeMs,
    pending
  });
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
