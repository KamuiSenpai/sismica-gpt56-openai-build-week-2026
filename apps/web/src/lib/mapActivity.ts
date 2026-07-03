import { type SeismicEvent } from "@sismica/shared";

import { estimatedIntensity, getEventPlace, intensityCssColor } from "./presentation";

export type EventHaloLayer = {
  eventId: string;
  longitude: number;
  latitude: number;
  radiusM: number;
  color: string;
  emphasis: number;
  selected: boolean;
  fresh: boolean;
  strong: boolean;
};

export type CoastalAttentionLayer = {
  areaId: string;
  eventId: string;
  longitude: number;
  latitude: number;
  radiusM: number;
  color: string;
  emphasis: number;
  label: string;
  tsunami: boolean;
  magnitude: number | null;
};

export type ActiveAreaLayer = {
  areaId: string;
  leadEventId: string;
  longitude: number;
  latitude: number;
  radiusM: number;
  color: string;
  emphasis: number;
  count: number;
  maxMagnitude: number;
  corridorPoints: Array<{ longitude: number; latitude: number }>;
};

export type TectonicCorridorLayer = {
  corridorId: string;
  leadEventId: string;
  label: string;
  kind: "subduction" | "convergent" | "transform";
  color: string;
  emphasis: number;
  points: Array<{ longitude: number; latitude: number }>;
};

type CorridorPreset = {
  id: string;
  label: string;
  kind: TectonicCorridorLayer["kind"];
  color: string;
  bbox: { west: number; east: number; south: number; north: number };
  points: Array<{ longitude: number; latitude: number }>;
  keywords?: string[];
};

const RECENT_HALO_WINDOW_MS = 4 * 60 * 60_000;
const COASTAL_WINDOW_MS = 8 * 60 * 60_000;
const ACTIVE_AREA_WINDOW_MS = 18 * 60 * 60_000;
const TECTONIC_CORRIDOR_LIMIT = 2;
const HALO_LIMIT = 4;
const COASTAL_LIMIT = 2;
const ACTIVE_AREA_LIMIT = 2;
const COASTAL_KEYWORDS = [
  "offshore",
  "coast",
  "costa",
  "mar",
  "sea",
  "strait",
  "gulf",
  "bay",
  "bahia",
  "isla",
  "islas",
  "island",
  "peninsula",
  "shore",
  "ocean",
  "oceano"
] as const;
const TECTONIC_CORRIDOR_PRESETS: CorridorPreset[] = [
  {
    id: "andes-subduction",
    label: "Subduccion andina",
    kind: "subduction",
    color: "#fbbf24",
    bbox: { west: -82.5, east: -68.5, south: -42, north: 8 },
    points: [
      { longitude: -81.6, latitude: -3.2 },
      { longitude: -79.6, latitude: -8.8 },
      { longitude: -77.1, latitude: -14.5 },
      { longitude: -73.9, latitude: -20.7 },
      { longitude: -72.6, latitude: -29.2 },
      { longitude: -75.2, latitude: -38.6 }
    ],
    keywords: ["peru", "chile", "ecuador", "arequipa", "tarapaca", "valparaiso"]
  },
  {
    id: "central-america-subduction",
    label: "Subduccion de America Central",
    kind: "subduction",
    color: "#f59e0b",
    bbox: { west: -107.5, east: -84, south: 7, north: 20.5 },
    points: [
      { longitude: -105.2, latitude: 18.8 },
      { longitude: -100.3, latitude: 16.4 },
      { longitude: -95.1, latitude: 14.9 },
      { longitude: -90.9, latitude: 12.6 },
      { longitude: -86.7, latitude: 10.2 }
    ],
    keywords: ["mexico", "guatemala", "el salvador", "nicaragua", "costa rica"]
  },
  {
    id: "caribbean-arc",
    label: "Arco de las Antillas",
    kind: "convergent",
    color: "#22d3ee",
    bbox: { west: -64.5, east: -58, south: 10, north: 19.5 },
    points: [
      { longitude: -61.6, latitude: 18.9 },
      { longitude: -61.1, latitude: 17.3 },
      { longitude: -61.1, latitude: 15.8 },
      { longitude: -61.4, latitude: 14.2 },
      { longitude: -62.0, latitude: 12.8 },
      { longitude: -62.6, latitude: 11.4 }
    ],
    keywords: ["trinidad", "tobago", "caribe", "naiguata", "venezuela"]
  },
  {
    id: "mediterranean-anatolia",
    label: "Mediterraneo oriental y Anatolia",
    kind: "transform",
    color: "#fb7185",
    bbox: { west: 19, east: 45, south: 33, north: 41.5 },
    points: [
      { longitude: 20.3, latitude: 37.8 },
      { longitude: 28.7, latitude: 35.3 },
      { longitude: 34.5, latitude: 34.8 },
      { longitude: 39.4, latitude: 38.5 },
      { longitude: 44.0, latitude: 37.1 }
    ],
    keywords: ["turquia", "grecia", "egeo", "anatolia", "chipre"]
  },
  {
    id: "japan-kuril",
    label: "Japon - Kuriles",
    kind: "subduction",
    color: "#fbbf24",
    bbox: { west: 141, east: 165, south: 34, north: 56 },
    points: [
      { longitude: 141.9, latitude: 34.2 },
      { longitude: 143.4, latitude: 37.1 },
      { longitude: 144.5, latitude: 40.9 },
      { longitude: 149.3, latitude: 43.7 },
      { longitude: 156.4, latitude: 48.2 },
      { longitude: 164.1, latitude: 55.2 }
    ],
    keywords: ["japon", "hokkaido", "tohoku", "kuril", "kamchatka"]
  },
  {
    id: "philippines-mariana",
    label: "Filipinas - Marianas",
    kind: "subduction",
    color: "#fbbf24",
    bbox: { west: 120, east: 149, south: 4, north: 25 },
    points: [
      { longitude: 120.5, latitude: 21.6 },
      { longitude: 124.9, latitude: 14.7 },
      { longitude: 127.2, latitude: 8.1 },
      { longitude: 129.2, latitude: 1.1 },
      { longitude: 134.5, latitude: 7.0 },
      { longitude: 143.5, latitude: 11.5 }
    ],
    keywords: ["filipinas", "mindanao", "luzon", "marianas"]
  },
  {
    id: "sunda-banda",
    label: "Sunda - Banda",
    kind: "subduction",
    color: "#fbbf24",
    bbox: { west: 92, east: 132, south: -13, north: 8 },
    points: [
      { longitude: 92.3, latitude: 6.9 },
      { longitude: 96.4, latitude: 1.1 },
      { longitude: 104.6, latitude: -8.2 },
      { longitude: 112.2, latitude: -10.7 },
      { longitude: 120.9, latitude: -11.5 },
      { longitude: 124.9, latitude: -10.4 },
      { longitude: 132.7, latitude: -6.7 }
    ],
    keywords: ["indonesia", "java", "sumatra", "molucca", "papua", "banda", "sunda"]
  },
  {
    id: "alaska-aleutian",
    label: "Alaska - Aleutianas",
    kind: "subduction",
    color: "#fbbf24",
    bbox: { west: -179.5, east: -142, south: 49.5, north: 62.5 },
    points: [
      { longitude: -145.8, latitude: 59.3 },
      { longitude: -150.1, latitude: 56.6 },
      { longitude: -160.1, latitude: 53.7 },
      { longitude: -170.2, latitude: 51.4 },
      { longitude: -178.5, latitude: 50.6 }
    ],
    keywords: ["alaska", "aleutianas", "aleutian"]
  }
];

function deaccentLower(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function eventAgeMs(event: SeismicEvent, referenceMs: number): number {
  const parsed = Date.parse(event.eventTimeUtc);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, referenceMs - parsed);
}

function recentWeight(ageMs: number, windowMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs >= windowMs) return 0;
  return 1 - ageMs / windowMs;
}

function coastalDescriptor(title: string): string {
  return deaccentLower(getEventPlace(title));
}

function distanceKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number }
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(right.latitude - left.latitude);
  const dLon = toRadians(right.longitude - left.longitude);
  const lat1 = toRadians(left.latitude);
  const lat2 = toRadians(right.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isFarEnough(
  candidate: { latitude: number; longitude: number },
  accepted: Array<{ latitude: number; longitude: number }>,
  minimumDistanceKm: number
): boolean {
  return accepted.every((entry) => distanceKm(candidate, entry) >= minimumDistanceKm);
}

function isInsideBoundingBox(
  event: SeismicEvent,
  bbox: { west: number; east: number; south: number; north: number }
): boolean {
  return (
    event.longitude >= bbox.west &&
    event.longitude <= bbox.east &&
    event.latitude >= bbox.south &&
    event.latitude <= bbox.north
  );
}

function eventPriorityScore(
  event: SeismicEvent,
  selectedEventId: string | null,
  referenceMs: number
): number {
  const magnitude = event.magnitude ?? 0;
  const intensity = estimatedIntensity(event) ?? 2;
  const recent = recentWeight(eventAgeMs(event, referenceMs), ACTIVE_AREA_WINDOW_MS);
  return (event.eventId === selectedEventId ? 120 : 0) + magnitude * 18 + intensity * 10 + recent * 80;
}

function isCoastalEvent(event: SeismicEvent): boolean {
  if (event.tsunami) return true;
  const descriptor = coastalDescriptor(event.title);
  return COASTAL_KEYWORDS.some((keyword) => descriptor.includes(keyword));
}

function clusterKey(event: SeismicEvent): string {
  const latBucket = Math.round(event.latitude / 6);
  const lonBucket = Math.round(event.longitude / 8);
  return `${latBucket}:${lonBucket}`;
}

function buildCorridorPoints(events: SeismicEvent[]): Array<{ longitude: number; latitude: number }> {
  if (events.length < 3) return [];

  const latitude = events.reduce((sum, event) => sum + event.latitude, 0) / events.length;
  const lonScale = Math.max(0.3, Math.cos((latitude * Math.PI) / 180));
  const latSpan =
    Math.max(...events.map((event) => event.latitude)) - Math.min(...events.map((event) => event.latitude));
  const lonSpanKm =
    (Math.max(...events.map((event) => event.longitude)) -
      Math.min(...events.map((event) => event.longitude))) *
    111 *
    lonScale;
  const dominantAxis = lonSpanKm >= latSpan * 111 ? "longitude" : "latitude";
  const dominantSpanKm = dominantAxis === "longitude" ? lonSpanKm : latSpan * 111;
  if (dominantSpanKm < 180) return [];

  const sorted = [...events].sort((left, right) =>
    dominantAxis === "longitude" ? left.longitude - right.longitude : left.latitude - right.latitude
  );
  const midIndex = Math.floor(sorted.length / 2);
  const picks = [sorted[0], sorted[midIndex], sorted[sorted.length - 1]];

  return picks.map((event) => ({ longitude: event.longitude, latitude: event.latitude }));
}

export function buildEventHaloLayers(
  events: SeismicEvent[],
  selectedEventId: string | null,
  referenceMs = Date.now()
): EventHaloLayer[] {
  const ranked = events
    .map((event) => {
      const magnitude = event.magnitude ?? 0;
      const intensity = estimatedIntensity(event) ?? 2;
      const ageMs = eventAgeMs(event, referenceMs);
      const fresh = ageMs <= RECENT_HALO_WINDOW_MS;
      const strong = magnitude >= 4.5 || intensity >= 4;
      const selected = event.eventId === selectedEventId;
      if (!selected && !fresh && !strong) return null;
      if (!selected && magnitude < 3.4 && intensity < 3.4) return null;

      const recent = recentWeight(ageMs, RECENT_HALO_WINDOW_MS);
      const score = (selected ? 260 : 0) + recent * 120 + magnitude * 18 + intensity * 13;

      return {
        score,
        layer: {
          eventId: event.eventId,
          longitude: event.longitude,
          latitude: event.latitude,
          radiusM: Math.round(
            28_000 + intensity * 17_000 + magnitude * 11_000 + recent * 24_000 + (selected ? 26_000 : 0)
          ),
          color: intensityCssColor(intensity),
          emphasis: Math.min(1.35, 0.72 + magnitude * 0.07 + intensity * 0.04 + (selected ? 0.18 : 0)),
          selected,
          fresh,
          strong
        }
      };
    })
    .filter((entry): entry is { score: number; layer: EventHaloLayer } => entry !== null)
    .sort((left, right) => right.score - left.score);

  const accepted: EventHaloLayer[] = [];
  const acceptedPoints: Array<{ latitude: number; longitude: number }> = [];
  for (const entry of ranked) {
    const minimumDistanceKm = entry.layer.selected ? 0 : 180;
    if (
      !entry.layer.selected &&
      !isFarEnough(
        { latitude: entry.layer.latitude, longitude: entry.layer.longitude },
        acceptedPoints,
        minimumDistanceKm
      )
    ) {
      continue;
    }
    accepted.push(entry.layer);
    acceptedPoints.push({ latitude: entry.layer.latitude, longitude: entry.layer.longitude });
    if (accepted.length >= HALO_LIMIT) break;
  }
  return accepted;
}

export function buildCoastalAttentionLayers(
  events: SeismicEvent[],
  selectedEventId: string | null,
  referenceMs = Date.now()
): CoastalAttentionLayer[] {
  const ranked = events
    .map((event) => {
      if (!isCoastalEvent(event)) return null;

      const ageMs = eventAgeMs(event, referenceMs);
      const recent = recentWeight(ageMs, COASTAL_WINDOW_MS);
      const magnitude = event.magnitude ?? 0;
      const selected = event.eventId === selectedEventId;
      if (!event.tsunami && !selected && recent <= 0 && magnitude < 5) return null;
      if (!event.tsunami && !selected && magnitude < 4.6) return null;

      const descriptor = getEventPlace(event.title).trim();
      const score = (selected ? 90 : 0) + recent * 110 + magnitude * 18 + (event.tsunami ? 85 : 0);

      return {
        score,
        layer: {
          areaId: event.eventId,
          eventId: event.eventId,
          longitude: event.longitude,
          latitude: event.latitude,
          radiusM: Math.round(54_000 + magnitude * 19_000 + recent * 24_000 + (event.tsunami ? 52_000 : 0)),
          color: event.tsunami ? "#38bdf8" : "#7dd3fc",
          emphasis: Math.min(1.18, 0.7 + magnitude * 0.05 + recent * 0.12 + (event.tsunami ? 0.16 : 0)),
          label: descriptor || event.title,
          tsunami: event.tsunami,
          magnitude: event.magnitude
        }
      };
    })
    .filter((entry): entry is { score: number; layer: CoastalAttentionLayer } => entry !== null)
    .sort((left, right) => right.score - left.score);

  const accepted: CoastalAttentionLayer[] = [];
  const acceptedPoints: Array<{ latitude: number; longitude: number }> = [];
  for (const entry of ranked) {
    const minimumDistanceKm = entry.layer.tsunami ? 0 : 320;
    if (
      !entry.layer.tsunami &&
      !isFarEnough(
        { latitude: entry.layer.latitude, longitude: entry.layer.longitude },
        acceptedPoints,
        minimumDistanceKm
      )
    ) {
      continue;
    }
    accepted.push(entry.layer);
    acceptedPoints.push({ latitude: entry.layer.latitude, longitude: entry.layer.longitude });
    if (accepted.length >= COASTAL_LIMIT) break;
  }
  return accepted;
}

export function buildActiveAreaLayers(events: SeismicEvent[], referenceMs = Date.now()): ActiveAreaLayer[] {
  const clusters = new Map<string, SeismicEvent[]>();

  for (const event of events) {
    const ageMs = eventAgeMs(event, referenceMs);
    const magnitude = event.magnitude ?? 0;
    if (ageMs > ACTIVE_AREA_WINDOW_MS && magnitude < 5.6) continue;

    const key = clusterKey(event);
    const bucket = clusters.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      clusters.set(key, [event]);
    }
  }

  const ranked = [...clusters.entries()]
    .map(([key, bucket]) => {
      const count = bucket.length;
      const maxMagnitude = Math.max(...bucket.map((event) => event.magnitude ?? 0));
      const latestRecent = bucket.reduce(
        (best, event) => Math.max(best, recentWeight(eventAgeMs(event, referenceMs), 6 * 60 * 60_000)),
        0
      );
      if (count < 3 && maxMagnitude < 5.8) return null;
      if (count < 4 && maxMagnitude < 4.6 && latestRecent < 0.35) return null;
      const leadEvent = [...bucket].sort((left, right) => {
        const magnitudeGap = (right.magnitude ?? 0) - (left.magnitude ?? 0);
        if (magnitudeGap !== 0) return magnitudeGap;
        return Date.parse(right.eventTimeUtc) - Date.parse(left.eventTimeUtc);
      })[0];
      if (!leadEvent) return null;

      const latitude = bucket.reduce((sum, event) => sum + event.latitude, 0) / count;
      const longitude = bucket.reduce((sum, event) => sum + event.longitude, 0) / count;
      const lonScale = Math.max(0.3, Math.cos((latitude * Math.PI) / 180));
      const latSpan =
        Math.max(...bucket.map((event) => event.latitude)) -
        Math.min(...bucket.map((event) => event.latitude));
      const lonSpanKm =
        (Math.max(...bucket.map((event) => event.longitude)) -
          Math.min(...bucket.map((event) => event.longitude))) *
        111 *
        lonScale;
      const dominantSpanKm = Math.max(latSpan * 111, lonSpanKm);
      const averageIntensity =
        bucket.reduce((sum, event) => sum + (estimatedIntensity(event) ?? 2), 0) / Math.max(1, bucket.length);
      const recent =
        bucket.reduce(
          (sum, event) => sum + recentWeight(eventAgeMs(event, referenceMs), ACTIVE_AREA_WINDOW_MS),
          0
        ) / Math.max(1, bucket.length);
      const score = count * 26 + maxMagnitude * 18 + recent * 80 + dominantSpanKm * 0.08;

      return {
        score,
        layer: {
          areaId: key,
          leadEventId: leadEvent.eventId,
          longitude,
          latitude,
          radiusM: Math.round(
            40_000 + count * 14_000 + maxMagnitude * 9_000 + dominantSpanKm * 75 + recent * 18_000
          ),
          color: intensityCssColor(Math.max(1, Math.min(8, averageIntensity))),
          emphasis: Math.min(1.18, 0.7 + count * 0.04 + recent * 0.1 + maxMagnitude * 0.015),
          count,
          maxMagnitude,
          corridorPoints: buildCorridorPoints(bucket)
        }
      };
    })
    .filter((entry): entry is { score: number; layer: ActiveAreaLayer } => entry !== null)
    .sort((left, right) => right.score - left.score);

  const accepted: ActiveAreaLayer[] = [];
  const acceptedPoints: Array<{ latitude: number; longitude: number }> = [];
  for (const entry of ranked) {
    if (
      !isFarEnough({ latitude: entry.layer.latitude, longitude: entry.layer.longitude }, acceptedPoints, 520)
    ) {
      continue;
    }
    accepted.push(entry.layer);
    acceptedPoints.push({ latitude: entry.layer.latitude, longitude: entry.layer.longitude });
    if (accepted.length >= ACTIVE_AREA_LIMIT) break;
  }
  return accepted;
}

export function buildTectonicCorridorLayers(
  events: SeismicEvent[],
  selectedEventId: string | null,
  referenceMs = Date.now()
): TectonicCorridorLayer[] {
  const candidates = events
    .map((event) => {
      const descriptor = coastalDescriptor(event.title);
      const priority = eventPriorityScore(event, selectedEventId, referenceMs);
      if (priority < 65) return [];

      return TECTONIC_CORRIDOR_PRESETS.filter((preset) => {
        const keywordMatch = preset.keywords?.some((keyword) => descriptor.includes(keyword)) ?? false;
        return keywordMatch || isInsideBoundingBox(event, preset.bbox);
      }).map((preset) => ({
        score:
          priority +
          (event.eventId === selectedEventId ? 90 : 0) +
          ((preset.keywords?.some((keyword) => descriptor.includes(keyword)) ?? false) ? 35 : 0),
        layer: {
          corridorId: preset.id,
          leadEventId: event.eventId,
          label: preset.label,
          kind: preset.kind,
          color: preset.color,
          emphasis: Math.min(1.2, 0.78 + (event.magnitude ?? 0) * 0.04),
          points: preset.points
        }
      }));
    })
    .flat()
    .sort((left, right) => right.score - left.score);

  const accepted: TectonicCorridorLayer[] = [];
  const used = new Set<string>();
  for (const entry of candidates) {
    if (used.has(entry.layer.corridorId)) continue;
    accepted.push(entry.layer);
    used.add(entry.layer.corridorId);
    if (accepted.length >= TECTONIC_CORRIDOR_LIMIT) break;
  }
  return accepted;
}
