export type SpanishMapLabelKind = "country" | "admin1" | "city" | "marine" | "region";

export type SpanishMapLabel = {
  id: string;
  kind: SpanishMapLabelKind;
  name: string;
  latitude: number;
  longitude: number;
  minZoom: number;
  maxZoom: number;
  rank: number;
  population?: number;
};

export type SpanishMapLabelCatalog = {
  version: number;
  language: "es";
  source: {
    name: string;
    version: string;
    url: string;
  };
  labels: SpanishMapLabel[];
};

export type MapLabelBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type MapLabelSelectionOptions = {
  zoom: number;
  bounds: MapLabelBounds;
  maxCandidates?: number;
};

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const KIND_PRIORITY: Record<SpanishMapLabelKind, number> = {
  country: 0,
  marine: 1,
  region: 2,
  admin1: 3,
  city: 4
};

function longitudeIsVisible(longitude: number, bounds: MapLabelBounds): boolean {
  if (bounds.west <= bounds.east) return longitude >= bounds.west && longitude <= bounds.east;
  return longitude >= bounds.west || longitude <= bounds.east;
}

export function estimateMapZoom(cameraHeightMeters: number): number {
  const safeHeight = Math.max(1, cameraHeightMeters);
  const zoom = Math.log2(EARTH_CIRCUMFERENCE_METERS / safeHeight) + 1;
  return Math.min(20, Math.max(0, zoom));
}

export function selectMapLabelCandidates(
  labels: readonly SpanishMapLabel[],
  { zoom, bounds, maxCandidates = 500 }: MapLabelSelectionOptions
): SpanishMapLabel[] {
  const safeMaximum = Math.max(0, Math.trunc(maxCandidates));
  if (safeMaximum === 0) return [];

  return labels
    .filter(
      (label) =>
        label.minZoom <= zoom + 0.5 &&
        label.maxZoom >= zoom - 0.5 &&
        label.latitude >= bounds.south &&
        label.latitude <= bounds.north &&
        longitudeIsVisible(label.longitude, bounds)
    )
    .sort(
      (left, right) =>
        left.minZoom - right.minZoom ||
        KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind] ||
        left.rank - right.rank ||
        (right.population ?? 0) - (left.population ?? 0) ||
        left.name.localeCompare(right.name, "es")
    )
    .slice(0, safeMaximum);
}
