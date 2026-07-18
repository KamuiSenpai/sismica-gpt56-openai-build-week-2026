export type SourceCode =
  | "USGS"
  | "SED"
  | "RENASS"
  | "ISC"
  | "GA"
  | "NRCAN"
  | "NCEDC"
  | "KNMI"
  | "SCEDC"
  | "EMSC"
  | "IGP"
  | "FUNVISIS"
  | "GEOFON"
  | "GEONET"
  | "BMKG"
  | "JMA"
  | "CWA"
  | "SGC"
  | "IGN"
  | "SSN"
  | "CSN"
  | "INGV"
  | "IGEPN"
  | "INPRES"
  | "MARN"
  | "OVSICORI"
  | "INSIVUMEH";
export type OperationalSourceCode = SourceCode | "GDACS" | "NOAA_PTWC" | "NOAA_NTWC";

export type SeismicEvent = {
  eventId: string;
  source: SourceCode;
  sourceEventId: string;
  title: string;
  magnitude: number | null;
  magnitudeType: string | null;
  latitude: number;
  longitude: number;
  depthKm: number | null;
  mmi: number | null;
  cdi: number | null;
  intensityText: string | null;
  stationCount: number | null;
  azimuthalGapDeg: number | null;
  nearestStationDeg: number | null;
  rmsSec: number | null;
  significance: number | null;
  feltReports: number | null;
  alertLevel: string | null;
  tsunami: boolean;
  networkCode: string | null;
  providerEventCode: string | null;
  eventType: string | null;
  detailUrl: string | null;
  sources: SourceCode[];
  sourceCount: number;
  eventTimeUtc: string;
  updatedAtUtc: string | null;
  status: string | null;
  sourceUrl: string | null;
  ingestedAt: string;
};

export type EventSourceReference = {
  source: SourceCode;
  sourceEventId: string;
  sourceUrl: string | null;
  magnitude: number | null;
  eventTimeUtc: string;
  updatedAtUtc: string | null;
};

export type SourceStatus = {
  source: OperationalSourceCode;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  status: "success" | "error" | "running" | "unknown";
  insertedCount: number;
  updatedCount: number;
  associatedCount: number;
  errorMessage: string | null;
};

export type EventsQuery = {
  minMagnitude: number;
  hours: number;
  limit: number;
};

export type ContinentCode = "SA" | "NA" | "EU" | "AS" | "AF" | "OC";

export type CountrySeismicPresence = {
  countryCode: string;
  countryName: string;
  count: number;
  percentage: number;
};

export type ContinentSeismicPresence = {
  continentCode: ContinentCode;
  continentName: string;
  countries: CountrySeismicPresence[];
};

export type SeismicPresenceSummary = {
  generatedAt: string;
  totalRecords: number;
  assignedRecords: number;
  unassignedRecords: number;
  startYear: number | null;
  endYear: number | null;
  continents: ContinentSeismicPresence[];
};

export type StreamEvent = {
  type: "event.created" | "event.updated";
  payload: SeismicEvent;
};

export type StationStatus = "unknown" | "online" | "delayed" | "offline" | "triggered";
export type StationPhase = "P" | "S" | "UNKNOWN";

export type StationState = {
  stationId: string;
  sequence: number;
  status: StationStatus;
  phase: StationPhase | null;
  observedAtUtc: string;
  latencyMs: number | null;
  triggerValue: number | null;
  engine: string;
};

export type SeismicStation = {
  stationId: string;
  source: "GEOFON";
  networkCode: string;
  stationCode: string;
  siteName: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  positionType: "fixed_catalog";
  elevationM: number | null;
  startTimeUtc: string | null;
  endTimeUtc: string | null;
  status: StationStatus;
  phase: StationPhase | null;
  latencyMs: number | null;
  triggerValue: number | null;
  observedAtUtc: string | null;
  sequence: number | null;
  engine: string | null;
  sourceUrl: string;
};

export type StationStreamEvent = {
  type: "station.state";
  payload: StationState;
};

export type ExperimentalOrigin = {
  originId: string;
  engine: string;
  status: "candidate" | "located" | "discarded" | "confirmed";
  quality: "preliminary" | "acceptable" | "rejected";
  originTimeUtc: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  magnitude: number | null;
  stationCount: number;
  rmsSec: number | null;
  azimuthalGapDeg: number | null;
};

export type DisasterContext = {
  contextId: string;
  source: "GDACS";
  sourceEventId: string;
  eventId: string | null;
  title: string;
  alertLevel: string | null;
  alertScore: number | null;
  country: string | null;
  latitude: number;
  longitude: number;
  eventTimeUtc: string;
  updatedAtUtc: string | null;
  sourceUrl: string | null;
};

export type TsunamiProduct = {
  productId: string;
  source: "NOAA_PTWC" | "NOAA_NTWC";
  identifier: string;
  center: string;
  event: string;
  status: string;
  messageType: string;
  urgency: string | null;
  severity: string | null;
  certainty: string | null;
  sentAtUtc: string;
  onsetAtUtc: string | null;
  expiresAtUtc: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  areaDescription: string | null;
  sourceUrl: string | null;
};

export type UsgsFeature = {
  id: string;
  properties: {
    mag: number | null;
    magType?: string;
    place?: string;
    time?: number;
    updated?: number;
    status?: string;
    title?: string;
    url?: string;
    mmi?: number | null;
    cdi?: number | null;
    alert?: string | null;
    detail?: string;
    felt?: number | null;
    tsunami?: number;
    sig?: number;
    net?: string;
    code?: string;
    nst?: number | null;
    dmin?: number | null;
    rms?: number | null;
    gap?: number | null;
    type?: string;
  };
  geometry: {
    coordinates: [number, number, number?];
  };
};

export type UsgsGeoJson = {
  features: UsgsFeature[];
};

export const DEFAULT_MIN_MAGNITUDE = 3.0;
export const DEFAULT_HOURS = 24;
export const DEFAULT_LIMIT = 100;

export function buildEventId(source: SourceCode, sourceEventId: string): string {
  return `${source}:${sourceEventId}`;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeUsgsFeature(
  feature: UsgsFeature,
  ingestedAt = new Date().toISOString()
): SeismicEvent {
  const [longitude, latitude, depthKm] = feature.geometry.coordinates;
  const props = feature.properties;

  return {
    eventId: buildEventId("USGS", feature.id),
    source: "USGS",
    sourceEventId: feature.id,
    title: props.title ?? props.place ?? "Evento sismico USGS",
    magnitude: isFiniteNumber(props.mag) ? props.mag : null,
    magnitudeType: props.magType ?? null,
    latitude,
    longitude,
    depthKm: isFiniteNumber(depthKm) ? depthKm : null,
    mmi: isFiniteNumber(props.mmi) ? props.mmi : null,
    cdi: isFiniteNumber(props.cdi) ? props.cdi : null,
    intensityText: null,
    stationCount: isFiniteNumber(props.nst) ? props.nst : null,
    azimuthalGapDeg: isFiniteNumber(props.gap) ? props.gap : null,
    nearestStationDeg: isFiniteNumber(props.dmin) ? props.dmin : null,
    rmsSec: isFiniteNumber(props.rms) ? props.rms : null,
    significance: isFiniteNumber(props.sig) ? props.sig : null,
    feltReports: isFiniteNumber(props.felt) ? props.felt : null,
    alertLevel: props.alert ?? null,
    tsunami: props.tsunami === 1,
    networkCode: props.net ?? null,
    providerEventCode: props.code ?? null,
    eventType: props.type ?? null,
    detailUrl: props.detail ?? null,
    sources: ["USGS"],
    sourceCount: 1,
    eventTimeUtc: isFiniteNumber(props.time) ? new Date(props.time).toISOString() : ingestedAt,
    updatedAtUtc: isFiniteNumber(props.updated) ? new Date(props.updated).toISOString() : null,
    status: props.status ?? null,
    sourceUrl: props.url ?? null,
    ingestedAt
  };
}

export * from "./youtubeChat.js";
