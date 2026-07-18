import { type SeismicEvent } from "@sismica/shared";

export type IntensityOverlayLayer = {
  mmi: number;
  label: string;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  radiusKm: number;
  zIndex: number;
  heightM: number;
  points: Array<{ longitude: number; latitude: number }>;
};

export type SeismicIntensityEpicenter = {
  lat: number;
  lng: number;
};

export type DrawSeismicIntensityPolygonsOptions = {
  eventId?: string;
  pointCount?: number;
  maxMmi?: number | null;
  mmi?: number | null;
  cdi?: number | null;
  intensityText?: string | null;
};

const EARTH_RADIUS_KM = 6371.0088;
const MIN_ESTIMATED_RADIUS_KM = 14;
const MAX_ESTIMATED_RADIUS_KM = 820;
const DEFAULT_POLYGON_POINT_COUNT = 128;
const ESTIMATED_SHAKE_COLORS: Record<number, string> = {
  1: "#93cfe8",
  2: "#68b8dd",
  3: "#4aa9d8",
  4: "#2f8fb8",
  5: "#2f9d44",
  6: "#c8b536",
  7: "#d07a25",
  8: "#a72a24",
  9: "#6f1838"
};
const ESTIMATED_SHAKE_ALPHA: Record<number, number> = {
  1: 0.22,
  2: 0.3,
  3: 0.38,
  4: 0.42,
  5: 0.58,
  6: 0.62,
  7: 0.68,
  8: 0.76,
  9: 0.84
};
const ESTIMATED_SHAKE_STROKE_ALPHA: Record<number, number> = {
  1: 0.2,
  2: 0.22,
  3: 0.24,
  4: 0.26,
  5: 0.28,
  6: 0.3,
  7: 0.32,
  8: 0.34,
  9: 0.36
};

// Same IPE used by presentation. This is only used to scale the visual fallback.
const IPE = { c0: 3.95, c1: 0.913, c2: -1.107, c3: 0.813 };

const ROMAN_TO_MMI: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function projectPoint(
  longitude: number,
  latitude: number,
  distanceKm: number,
  bearingRad: number
): { longitude: number; latitude: number } {
  const lat1 = toRad(latitude);
  const lon1 = toRad(longitude);
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAngular = Math.sin(angularDistance);
  const cosAngular = Math.cos(angularDistance);

  const lat2 = Math.asin(sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearingRad));
  const lon2 =
    lon1 + Math.atan2(Math.sin(bearingRad) * sinAngular * cosLat1, cosAngular - sinLat1 * Math.sin(lat2));

  return { longitude: normalizeLongitude(toDeg(lon2)), latitude: clamp(toDeg(lat2), -85, 85) };
}

function deterministicNoise(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function buildBaseRadialProfile(seed: number, vertexCount: number): number[] {
  const axis = (seed % 360) * (Math.PI / 180);
  const phaseA = deterministicNoise(seed, 1) * Math.PI * 2;
  const phaseB = deterministicNoise(seed, 2) * Math.PI * 2;
  const phaseC = deterministicNoise(seed, 3) * Math.PI * 2;
  const sectorCount = Math.max(10, Math.min(16, Math.trunc(vertexCount)));
  const anchors = Array.from({ length: sectorCount }, (_, anchorIndex) => {
    const angle = (anchorIndex / sectorCount) * Math.PI * 2;
    const seedA = deterministicNoise(seed, anchorIndex + 1);
    const seedB = deterministicNoise(seed, anchorIndex + 31);
    const seedC = deterministicNoise(seed, anchorIndex + 61);
    const broadAxis = 0.1 * Math.cos(angle - axis);
    const secondaryLobe = 0.055 * Math.sin(angle * 2 + phaseA);
    const tertiaryLobe = 0.03 * Math.cos(angle * 3 + phaseB);
    const softVariation = 0.02 * Math.cos(angle * 4 + phaseC);
    const irregularity = (seedA - 0.5) * 0.09 + (seedB - 0.5) * 0.05 + (seedC - 0.5) * 0.03;
    return clamp(1 + broadAxis + secondaryLobe + tertiaryLobe + softVariation + irregularity, 0.82, 1.2);
  });
  const average = anchors.reduce((sum, value) => sum + value, 0) / Math.max(1, anchors.length);
  return anchors.map((value) => clamp(value / average, 0.82, 1.2));
}

function cyclicValue(values: number[], index: number): number {
  return values[((index % values.length) + values.length) % values.length] ?? 1;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

// GlobalQuake genera un punto geodesico por angulo y cierra un unico contorno.
// Aqui suavizamos las longitudes radiales antes de proyectarlas sobre el globo.
function sampleSmoothRadialOutline(
  longitude: number,
  latitude: number,
  radiusKm: number,
  radialProfile: number[],
  pointCount: number
): Array<{ longitude: number; latitude: number }> {
  if (radialProfile.length === 0 || pointCount <= 0) return [];

  return Array.from({ length: pointCount }, (_, index) => {
    const position = (index / pointCount) * radialProfile.length;
    const leftIndex = Math.floor(position);
    const fraction = position - leftIndex;
    const factor = clamp(
      catmullRom(
        cyclicValue(radialProfile, leftIndex - 1),
        cyclicValue(radialProfile, leftIndex),
        cyclicValue(radialProfile, leftIndex + 1),
        cyclicValue(radialProfile, leftIndex + 2),
        fraction
      ),
      0.8,
      1.22
    );
    const bearing = (index / pointCount) * Math.PI * 2;
    return projectPoint(longitude, latitude, radiusKm * factor, bearing);
  });
}

function profileForLayer(baseProfile: number[], layerIndex: number, totalLayers: number): number[] {
  const progress = totalLayers <= 1 ? 0 : layerIndex / (totalLayers - 1);
  const contrast = clamp(1 - progress * 0.06, 0.9, 1);
  const tightening = clamp(1 - progress * 0.02, 0.95, 1);

  return baseProfile.map((value) => {
    return clamp(1 + (value - 1) * contrast * tightening, 0.82, 1.2);
  });
}

function parseIntensityText(text: string | null): number | null {
  if (!text) return null;
  const match = text
    .trim()
    .toUpperCase()
    .match(/\b(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/);
  return match?.[1] ? (ROMAN_TO_MMI[match[1]] ?? null) : null;
}

function modelEpicentralMmi(magnitude: number, depthKm: number): number {
  const rrup = Math.max(1, depthKm);
  const saturation = 1 + IPE.c3 * Math.exp(magnitude - 5);
  const mmi =
    IPE.c0 + IPE.c1 * magnitude + IPE.c2 * Math.log(Math.sqrt(rrup * rrup + saturation * saturation));
  return clamp(mmi, 1, 12);
}

function estimateMaxIntensity(
  magnitude: number,
  depthKm: number,
  options: Pick<DrawSeismicIntensityPolygonsOptions, "maxMmi" | "mmi" | "cdi" | "intensityText">
): number {
  const model = modelEpicentralMmi(magnitude, depthKm);
  const shallowWeight = clamp(1 - Math.max(0, depthKm - 10) / 140, 0, 1);
  const strongCore = 4.5 + (magnitude - 4.4) * 1.22 + shallowWeight * 1.05;
  const officialCandidates = [
    options.maxMmi,
    options.mmi,
    options.cdi,
    parseIntensityText(options.intensityText ?? null)
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 1);
  const official = officialCandidates.length ? Math.max(...officialCandidates) : null;
  return clamp(Math.max(model, strongCore, official ?? 0), 1, 12);
}

function maxVisualLevel(maxMmi: number): number {
  if (maxMmi >= 8.7) return 9;
  if (maxMmi >= 7.6) return 8;
  if (maxMmi >= 6.5) return 7;
  if (maxMmi >= 5.5) return 6;
  if (maxMmi >= 4.5) return 5;
  if (maxMmi >= 3.6) return 4;
  if (maxMmi >= 2.5) return 3;
  if (maxMmi >= 1.6) return 2;
  return 1;
}

function visualLevelsForMax(maxLevel: number): number[] {
  switch (maxLevel) {
    case 1:
      return [1];
    case 2:
      return [1, 2];
    case 3:
      return [1, 2, 3];
    case 4:
      return [1, 2, 4];
    case 5:
      return [1, 3, 5];
    case 6:
      return [2, 4, 6];
    case 7:
      return [2, 5, 7];
    case 8:
      return [3, 6, 8];
    default:
      return [3, 6, 9];
  }
}

function radiusFactorForLayer(index: number, total: number): number {
  if (total <= 1) return 0.2;
  const progress = index / (total - 1);
  return clamp(1 - Math.pow(progress, 0.82) * 0.905, 0.095, 1);
}

function outerVisualRadiusKm(magnitude: number, depthKm: number, maxLevel: number): number {
  const shallowFactor = clamp(1.14 - Math.max(0, depthKm - 8) / 360, 0.58, 1.12);
  const magnitudeRadius = 34 + Math.pow(Math.max(1.8, magnitude), 2.02) * 5.4;
  const intensityBoost = 1 + Math.max(0, maxLevel - 5) * 0.045;
  return clamp(
    magnitudeRadius * shallowFactor * intensityBoost,
    MIN_ESTIMATED_RADIUS_KM * 4,
    MAX_ESTIMATED_RADIUS_KM
  );
}

function seedFromEventId(eventId: string | undefined, epicenter: SeismicIntensityEpicenter): number {
  const source =
    eventId && eventId.trim() ? eventId : `${epicenter.lat.toFixed(3)}:${epicenter.lng.toFixed(3)}`;
  return source.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

export function drawSeismicIntensityPolygons(
  epicenter: SeismicIntensityEpicenter,
  magnitude: number,
  depthKm: number,
  options: DrawSeismicIntensityPolygonsOptions = {}
): IntensityOverlayLayer[] {
  if (![epicenter.lat, epicenter.lng, magnitude, depthKm].every(Number.isFinite)) return [];

  const safeDepthKm = Math.max(1, depthKm);
  const maxMmi = estimateMaxIntensity(magnitude, safeDepthKm, options);
  if (magnitude < 2.5 && maxMmi < 3.2) return [];

  const maxLevel = maxVisualLevel(maxMmi);
  const visibleLevels = visualLevelsForMax(maxLevel);
  const outerRadiusKm = outerVisualRadiusKm(magnitude, safeDepthKm, maxLevel);
  const seed = seedFromEventId(options.eventId, epicenter);
  const pointCount = Math.max(
    72,
    Math.min(180, Math.trunc(options.pointCount ?? DEFAULT_POLYGON_POINT_COUNT))
  );
  const vertexCount = Math.max(10, Math.min(16, Math.round(pointCount / 8)));
  const baseProfile = buildBaseRadialProfile(seed, vertexCount);
  const layers: IntensityOverlayLayer[] = [];

  visibleLevels.forEach((level, index) => {
    const radiusKm = clamp(
      outerRadiusKm * radiusFactorForLayer(index, visibleLevels.length),
      MIN_ESTIMATED_RADIUS_KM,
      MAX_ESTIMATED_RADIUS_KM
    );

    layers.push({
      mmi: level,
      label: `MMI ${level}`,
      fillColor: ESTIMATED_SHAKE_COLORS[level] ?? "#64748b",
      fillOpacity: ESTIMATED_SHAKE_ALPHA[level] ?? 0.4,
      strokeColor: ESTIMATED_SHAKE_COLORS[level] ?? "#64748b",
      strokeOpacity: ESTIMATED_SHAKE_STROKE_ALPHA[level] ?? 0.05,
      radiusKm,
      zIndex: index + 1,
      heightM: 900 + (index + 1) * 140,
      points: sampleSmoothRadialOutline(
        epicenter.lng,
        epicenter.lat,
        radiusKm,
        profileForLayer(baseProfile, index, visibleLevels.length),
        pointCount
      )
    });
  });

  return layers;
}

export function buildEstimatedIntensityOverlay(event: SeismicEvent): IntensityOverlayLayer[] {
  if (typeof event.magnitude !== "number") return [];
  return drawSeismicIntensityPolygons(
    { lat: event.latitude, lng: event.longitude },
    event.magnitude,
    event.depthKm ?? 10,
    {
      eventId: event.eventId,
      mmi: event.mmi,
      cdi: event.cdi,
      intensityText: event.intensityText
    }
  );
}
