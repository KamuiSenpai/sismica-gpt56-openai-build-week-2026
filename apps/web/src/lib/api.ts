import {
  DEFAULT_HOURS,
  DEFAULT_MIN_MAGNITUDE,
  normalizeUsgsFeature,
  type DisasterContext,
  type SeismicEvent,
  type SourceStatus,
  type TsunamiProduct,
  type UsgsGeoJson
} from "@sismica/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

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

export function buildStreamUrl(): string {
  return `${API_BASE_URL}/api/stream`;
}
