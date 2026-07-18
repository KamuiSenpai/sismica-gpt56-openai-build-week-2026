import {
  DEFAULT_HOURS,
  DEFAULT_MIN_MAGNITUDE,
  normalizeUsgsFeature,
  type DisasterContext,
  type ExperimentalOrigin,
  type OfficialImpactSummary,
  type SeismicEvent,
  type SeismicPresenceSummary,
  type SeismicStation,
  type SourceStatus,
  type TsunamiProduct,
  type UsgsGeoJson
} from "@sismica/shared";

import type { DirectorSegmentKind, NarrationEditorial, NarrationMode, SegmentPacket } from "./editorial";
import {
  IOC_SEA_LEVEL_DATA_URL,
  IOC_SEA_LEVEL_STATIONLIST_URL,
  normalizeSeaLevelSeries,
  normalizeSeaLevelStations,
  type SeaLevelStationSeries,
  type SeaLevelStation
} from "./seaLevel";

const API_BASE_URL =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ??
  "http://localhost:3000";

type EventsResponse = {
  items: SeismicEvent[];
};

type SourcesResponse = {
  items: SourceStatus[];
};

type DisastersResponse = {
  items: DisasterContext[];
};

type TsunamiResponse = {
  items: TsunamiProduct[];
};

type StationsResponse = {
  items: SeismicStation[];
};

type ExperimentalOriginsResponse = {
  items: ExperimentalOrigin[];
};

export type SeismicBridgeLibrary =
  | "short"
  | "extended"
  | "informative"
  | "educational"
  | "official-informative"
  | "official-educational"
  | "official-promotional";
export type SeismicBridgeApprovalStatus = "pending" | "approved" | "rejected";
export type SeismicBridgeManifestItem = {
  voice: string;
  classId?: string | null;
  playbackRole?: string | null;
  groupId: string;
  variant: string;
  text: string;
  bytes: number | null;
  durationMs: number | null;
  approvalStatus: SeismicBridgeApprovalStatus | null;
  path: string;
  url: string;
  keywords: string[];
};
export type SeismicBridgeManifestGroup = {
  id: string;
  kind: string | null;
  status: string | null;
  variants: number;
};
export type SeismicBridgeManifest = {
  library: SeismicBridgeLibrary;
  version: string | null;
  generatedAtUtc: string | null;
  voices: string[];
  groups: SeismicBridgeManifestGroup[];
  items: SeismicBridgeManifestItem[];
};
export type VoiceTelemetryEvent = {
  clientId: string;
  kind: string;
  eventId?: string;
  hostId?: string;
  engine?: string;
  voice?: string;
  library?: SeismicBridgeLibrary;
  variant?: string;
  requestedGroupId?: string;
  selectedGroupId?: string;
  clipText?: string;
  cacheState?: string;
  wordBucket?: string;
  reason?: string;
  outcome?: string;
  wordCount?: number;
  durationMs?: number;
};

export type EventExplanationResult = {
  provider: "openai";
  model: string;
  responseId: string;
  generatedAtUtc: string;
  disclaimer: string;
  cached: boolean;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  grounding: {
    eventId: string;
    eventVersionUtc: string;
    sourceCount: number;
    inputSha256: string;
  };
  explanation: {
    headline: string;
    overview: string;
    technicalReading: string;
    recommendedActions: string[];
    dataLimitations: string[];
  };
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type EventsInput = {
  minMagnitude?: number;
  hours?: number;
};

// --- Fallback directo a USGS cuando el backend propio no esta disponible ---

async function fetchEventsFromUsgs(input?: EventsInput): Promise<SeismicEvent[]> {
  const minMagnitude = input?.minMagnitude ?? DEFAULT_MIN_MAGNITUDE;
  const hours = input?.hours ?? DEFAULT_HOURS;
  const starttime = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const params = new URLSearchParams({
    format: "geojson",
    starttime,
    minmagnitude: String(minMagnitude),
    orderby: "time",
    limit: "200"
  });
  const response = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`USGS request failed: ${response.status}`);
  }
  const payload = (await response.json()) as UsgsGeoJson;
  const ingestedAt = new Date().toISOString();
  return payload.features.slice(0, 100).map((feature) => normalizeUsgsFeature(feature, ingestedAt));
}

// --- API publica del cliente ---

export async function fetchEvents(input?: EventsInput): Promise<SeismicEvent[]> {
  try {
    const params = new URLSearchParams({
      minMagnitude: String(input?.minMagnitude ?? DEFAULT_MIN_MAGNITUDE),
      hours: String(input?.hours ?? DEFAULT_HOURS),
      limit: "100"
    });
    const response = await fetch(`${API_BASE_URL}/api/events?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Events request failed: ${response.status}`);
    }
    const payload = (await response.json()) as EventsResponse;
    return payload.items;
  } catch (error) {
    console.warn("API propia no disponible; uso USGS directo (fallback).", error);
    return fetchEventsFromUsgs(input);
  }
}

export async function fetchSourceStatuses(): Promise<SourceStatus[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/sources/status`);
    if (!response.ok) {
      throw new Error(`Source status request failed: ${response.status}`);
    }
    const payload = (await response.json()) as SourcesResponse;
    return payload.items;
  } catch {
    return [
      {
        source: "USGS",
        lastRunStartedAt: null,
        lastRunFinishedAt: new Date().toISOString(),
        status: "success",
        insertedCount: 0,
        updatedCount: 0,
        associatedCount: 0,
        errorMessage: "Fallback directo a USGS (backend no disponible)"
      }
    ];
  }
}

export async function fetchSeismicBridgeManifest(
  library: SeismicBridgeLibrary,
  signal?: AbortSignal
): Promise<SeismicBridgeManifest | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tts/bridges/${library}/manifest`, { signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as Omit<SeismicBridgeManifest, "items"> & {
      items: Array<Omit<SeismicBridgeManifestItem, "url">>;
    };
    return {
      ...payload,
      items: payload.items.map((item) => ({
        ...item,
        url: new URL(item.path, `${API_BASE_URL}/`).toString()
      }))
    };
  } catch {
    return null;
  }
}

export function reportVoiceTelemetry(event: VoiceTelemetryEvent): void {
  void fetch(`${API_BASE_URL}/api/tts/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true
  }).catch(() => undefined);
}

export async function claimVoiceOutput(clientId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tts/owner`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId }),
      keepalive: true
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { granted?: boolean };
    return payload.granted === true;
  } catch {
    return false;
  }
}

export function releaseVoiceOutput(clientId: string): void {
  void fetch(`${API_BASE_URL}/api/tts/owner/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
    keepalive: true
  }).catch(() => undefined);
}

export async function fetchActiveDisasters(): Promise<DisasterContext[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/disasters/active`);
    if (!response.ok) throw new Error(`Disasters request failed: ${response.status}`);
    return ((await response.json()) as DisastersResponse).items;
  } catch {
    return [];
  }
}

export async function fetchActiveTsunamiProducts(): Promise<TsunamiProduct[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tsunami/active`);
    if (!response.ok) throw new Error(`Tsunami request failed: ${response.status}`);
    return ((await response.json()) as TsunamiResponse).items;
  } catch {
    return [];
  }
}

export async function fetchStations(): Promise<SeismicStation[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/stations?activeAt=${encodeURIComponent(new Date().toISOString())}&limit=5000`
    );
    if (!response.ok) throw new Error(`Stations request failed: ${response.status}`);
    return ((await response.json()) as StationsResponse).items;
  } catch (error) {
    console.warn("Catalogo de estaciones no disponible.", error);
    return [];
  }
}

export async function fetchSeaLevelStations(): Promise<SeaLevelStation[]> {
  try {
    const response = await fetch(IOC_SEA_LEVEL_STATIONLIST_URL);
    if (!response.ok) throw new Error(`Sea level station request failed: ${response.status}`);
    const payload = (await response.json()) as unknown;
    return normalizeSeaLevelStations(payload);
  } catch (error) {
    console.warn("Red IOC/UNESCO de nivel del mar no disponible.", error);
    return [];
  }
}

function formatIocUtc(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export async function fetchSeaLevelStationSeries(input: {
  stationCode: string;
  sensor?: string | null;
  unit?: string | null;
  hours?: number;
}): Promise<SeaLevelStationSeries | null> {
  const windowHours = Math.max(1, Math.min(24, Math.round(input.hours ?? 6)));
  try {
    const now = new Date();
    const start = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
    const params = new URLSearchParams({
      code: input.stationCode,
      timestart: formatIocUtc(start),
      timestop: formatIocUtc(now),
      format: "json"
    });
    if (input.sensor) {
      params.append("includesensors[]", input.sensor);
    }

    const response = await fetch(`${IOC_SEA_LEVEL_DATA_URL}&${params.toString()}`);
    if (!response.ok) throw new Error(`Sea level series request failed: ${response.status}`);
    const payload = (await response.json()) as unknown;
    return normalizeSeaLevelSeries(payload, {
      stationCode: input.stationCode,
      sensor: input.sensor ?? null,
      unit: input.unit ?? null,
      windowHours
    });
  } catch (error) {
    console.warn(`Serie IOC/UNESCO no disponible para ${input.stationCode}.`, error);
    return null;
  }
}

export async function fetchExperimentalOrigins(): Promise<ExperimentalOrigin[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/experimental-origins?hours=72&limit=200`);
    if (!response.ok) throw new Error(`Experimental origins request failed: ${response.status}`);
    return ((await response.json()) as ExperimentalOriginsResponse).items;
  } catch (error) {
    console.warn("Origenes experimentales no disponibles.", error);
    return [];
  }
}

export async function fetchSeismicPresence(): Promise<SeismicPresenceSummary | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/analytics/seismic-presence`);
    if (!response.ok) throw new Error(`Seismic presence request failed: ${response.status}`);
    return (await response.json()) as SeismicPresenceSummary;
  } catch (error) {
    console.warn("Resumen de presencia sismica no disponible.", error);
    return null;
  }
}

export async function fetchTopMagnitude(limit = 10): Promise<SeismicEvent[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/analytics/top-magnitude?limit=${limit}`);
    if (!response.ok) throw new Error(`Top magnitude request failed: ${response.status}`);
    return ((await response.json()) as EventsResponse).items;
  } catch (error) {
    console.warn("Top de mayor magnitud no disponible.", error);
    return [];
  }
}

export function resolveApiEndpoint(endpoint: string): string {
  return new URL(endpoint, `${API_BASE_URL.replace(/\/$/u, "")}/`).toString();
}

export async function fetchOfficialImpactSummary(
  eventId: string,
  signal?: AbortSignal
): Promise<OfficialImpactSummary | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/events/${encodeURIComponent(eventId)}/official-impact`,
      { signal }
    );
    if (!response.ok) return null;
    return (await response.json()) as OfficialImpactSummary;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}

export async function fetchEventExplanation(
  event: SeismicEvent,
  signal?: AbortSignal
): Promise<EventExplanationResult> {
  const response = await fetch(`${API_BASE_URL}/api/ai/explain-event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId: event.eventId }),
    signal
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiRequestError(
      payload?.error ?? `La explicacion respondio con estado ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as EventExplanationResult;
}

// Pauta editorial de narracion. El backend devuelve solo intro/remate/cue; el texto final
// se reconstruye localmente con datos deterministas de la tarjeta.
export async function fetchNarrationEditorial(
  event: SeismicEvent,
  input: {
    normalizedPlace: string;
    country?: string | null;
    mode?: NarrationMode;
    recentLines?: string[];
  }
): Promise<NarrationEditorial | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/narration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventId: event.eventId,
        title: event.title,
        normalizedPlace: input.normalizedPlace,
        country: input.country ?? null,
        mode: input.mode ?? "seguimiento",
        source: event.source,
        latitude: event.latitude,
        longitude: event.longitude,
        recentLines: input.recentLines ?? [],
        magnitude: event.magnitude,
        depthKm: event.depthKm,
        tsunami: event.tsunami,
        eventTimeUtc: event.eventTimeUtc,
        updatedAtUtc: event.updatedAtUtc
      })
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { editorial: NarrationEditorial | null };
    return payload.editorial ?? null;
  } catch {
    return null;
  }
}

// --- Director del directo (segmentos + decision IA) ---

type SegmentInput = {
  kind: DirectorSegmentKind | "recomendacion";
  totalLastHour?: number | null;
  biggestMagnitude?: number | null;
  biggestPlace?: string | null;
  topic?: string | null;
  windowMinutes?: 15 | 30 | 60;
  currentCount?: number | null;
  previousCount?: number | null;
  activeAreas?: string[];
  regionalFocus?: string | null;
  recentLines?: string[];
};

// Texto editorial de un segmento del director. null solo ante fallo de red; el director
// usa fallback local para texto y cue.
export async function fetchSegmentText(input: SegmentInput): Promise<SegmentPacket | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/segment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) return null;
    return (await response.json()) as SegmentPacket;
  } catch {
    return null;
  }
}

type DirectorState = {
  livePending: number;
  recentCount: number;
  minutesSinceRecap: number;
  minutesSinceEducativo: number;
  biggestRecentMagnitude?: number | null;
};

// Modo inteligente: DeepSeek decide el siguiente segmento. null ante fallo (el director usa reglas).
export async function fetchDirectorDecision(
  state: DirectorState
): Promise<{ kind: Exclude<DirectorSegmentKind, "boletin">; source: "ai" | "rules" } | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/director/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state)
    });
    if (!response.ok) return null;
    return (await response.json()) as {
      kind: Exclude<DirectorSegmentKind, "boletin">;
      source: "ai" | "rules";
    };
  } catch {
    return null;
  }
}

export function buildStreamUrl(): string {
  return `${API_BASE_URL}/api/stream`;
}

export function buildStationStreamUrl(): string {
  return `${API_BASE_URL}/api/stations/stream`;
}
