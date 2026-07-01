import {
  DEFAULT_HOURS,
  DEFAULT_MIN_MAGNITUDE,
  normalizeUsgsFeature,
  type DisasterContext,
  type ExperimentalOrigin,
  type SeismicEvent,
  type SeismicPresenceSummary,
  type SeismicStation,
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

type StationsResponse = {
  items: SeismicStation[];
};

type ExperimentalOriginsResponse = {
  items: ExperimentalOrigin[];
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

export function buildStreamUrl(): string {
  return `${API_BASE_URL}/api/stream`;
}

export function buildStationStreamUrl(): string {
  return `${API_BASE_URL}/api/stations/stream`;
}
