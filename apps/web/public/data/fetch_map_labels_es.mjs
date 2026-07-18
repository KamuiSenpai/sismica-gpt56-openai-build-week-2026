import { writeFile } from "node:fs/promises";

// Natural Earth is public domain. Pinning the release keeps the generated catalog reproducible.
const NATURAL_EARTH_VERSION = "5.1.2";
const SOURCE_ROOT = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v${NATURAL_EARTH_VERSION}/geojson`;
const OUTPUT_URL = new URL("./map-labels-es.json", import.meta.url);
const MAX_DETAIL_ZOOM = 7;

const SOURCES = {
  countries: "ne_10m_admin_0_countries.geojson",
  admin1: "ne_10m_admin_1_states_provinces.geojson",
  cities: "ne_10m_populated_places.geojson",
  marine: "ne_10m_geography_marine_polys.geojson",
  regions: "ne_10m_geography_regions_points.geojson"
};

// Natural Earth leaves a small set of marine and regional labels without NAME_ES.
const SPANISH_NAME_OVERRIDES = {
  "region:1159104901": "Isla Wright",
  "marine:1159116643": "Bahía de Plenty",
  "marine:1159118351": "Golfo de Olenek",
  "marine:1159118925": "Bahía de Santa Elena",
  "region:1159104983": "Cabo Fear",
  "region:1159104675": "Cabo Howe Occidental",
  "marine:1159119293": "Estrecho de Long Island",
  "marine:1159119635": "Bahía Wynniatt"
};

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function spanishName(properties, uppercase = false) {
  const candidates = uppercase
    ? [properties.NAME_ES, properties.NAME, properties.NAMEPAR]
    : [properties.name_es, properties.name, properties.namepar];

  const value = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim() && candidate !== "-99"
  );
  return value?.trim() ?? null;
}

function pointCoordinates(feature, longitudeKey, latitudeKey) {
  const longitude = finiteNumber(feature.properties?.[longitudeKey], Number.NaN);
  const latitude = finiteNumber(feature.properties?.[latitudeKey], Number.NaN);
  if (Number.isFinite(longitude) && Number.isFinite(latitude)) return [longitude, latitude];

  const coordinates = feature.geometry?.type === "Point" ? feature.geometry.coordinates : null;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  if (!Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return null;
  return [coordinates[0], coordinates[1]];
}

function unwrapRing(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return [];
  const unwrapped = [[ring[0][0], ring[0][1]]];

  for (let index = 1; index < ring.length; index += 1) {
    let longitude = ring[index][0];
    const latitude = ring[index][1];
    const previousLongitude = unwrapped[index - 1][0];
    while (longitude - previousLongitude > 180) longitude -= 360;
    while (longitude - previousLongitude < -180) longitude += 360;
    unwrapped.push([longitude, latitude]);
  }

  return unwrapped;
}

function ringCentroid(rawRing) {
  const ring = unwrapRing(rawRing);
  if (ring.length < 3) return null;

  let twiceArea = 0;
  let longitudeTotal = 0;
  let latitudeTotal = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    longitudeTotal += (x1 + x2) * cross;
    latitudeTotal += (y1 + y2) * cross;
  }

  if (Math.abs(twiceArea) < 1e-8) {
    const points = ring.slice(0, -1);
    if (points.length === 0) return null;
    return {
      area: 0,
      longitude: points.reduce((total, point) => total + point[0], 0) / points.length,
      latitude: points.reduce((total, point) => total + point[1], 0) / points.length
    };
  }

  return {
    area: Math.abs(twiceArea / 2),
    longitude: longitudeTotal / (3 * twiceArea),
    latitude: latitudeTotal / (3 * twiceArea)
  };
}

function polygonCentroid(geometry) {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.coordinates;
  if (!Array.isArray(polygons)) return null;

  let largest = null;
  for (const polygon of polygons) {
    const centroid = ringCentroid(polygon?.[0]);
    if (centroid && (!largest || centroid.area > largest.area)) largest = centroid;
  }
  if (!largest) return null;

  return [((largest.longitude + 180) % 360 + 360) % 360 - 180, largest.latitude];
}

function buildLabel(kind, name, coordinates, properties, index, options = {}) {
  if (!name || !coordinates) return null;
  const [longitude, latitude] = coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const sourceId =
    properties.NE_ID ??
    properties.ne_id ??
    properties.ADM0_A3 ??
    properties.adm1_code ??
    properties.GEONAMEID ??
    index;
  const minZoom = finiteNumber(options.minZoom, 0);
  const maxZoom = finiteNumber(options.maxZoom, 20);
  const population = finiteNumber(options.population, 0);

  return {
    id: `${kind}:${sourceId}`,
    kind,
    name,
    latitude: rounded(latitude),
    longitude: rounded(longitude),
    minZoom: rounded(minZoom),
    maxZoom: rounded(Math.max(minZoom, maxZoom)),
    rank: finiteNumber(options.rank, 99),
    ...(population > 0 ? { population } : {})
  };
}

async function fetchGeoJson(fileName) {
  const response = await fetch(`${SOURCE_ROOT}/${fileName}`);
  if (!response.ok) throw new Error(`Natural Earth ${fileName}: HTTP ${response.status}`);
  return response.json();
}

function collectCountries(features) {
  return features.map((feature, index) => {
    const properties = feature.properties ?? {};
    return buildLabel(
      "country",
      spanishName(properties, true),
      pointCoordinates(feature, "LABEL_X", "LABEL_Y"),
      properties,
      index,
      {
        minZoom: properties.MIN_LABEL,
        maxZoom: properties.MAX_LABEL,
        rank: properties.LABELRANK
      }
    );
  });
}

function collectAdmin1(features) {
  return features
    .map((feature, index) => {
      const properties = feature.properties ?? {};
      const minZoom = finiteNumber(properties.min_zoom, 99);
      if (minZoom > MAX_DETAIL_ZOOM) return null;
      return buildLabel(
        "admin1",
        spanishName(properties),
        pointCoordinates(feature, "longitude", "latitude"),
        properties,
        index,
        {
          minZoom,
          maxZoom: properties.max_zoom,
          rank: properties.labelrank
        }
      );
    })
    .filter(Boolean);
}

function collectCities(features) {
  return features
    .map((feature, index) => {
      const properties = feature.properties ?? {};
      const minZoom = finiteNumber(properties.MIN_ZOOM, 99);
      if (minZoom > MAX_DETAIL_ZOOM) return null;
      return buildLabel(
        "city",
        spanishName(properties, true),
        pointCoordinates(feature, "LONGITUDE", "LATITUDE"),
        properties,
        index,
        {
          minZoom,
          maxZoom: properties.MAX_ZOOM,
          rank: properties.LABELRANK,
          population: properties.POP_MAX
        }
      );
    })
    .filter(Boolean);
}

function collectMarine(features) {
  return features.map((feature, index) => {
    const properties = feature.properties ?? {};
    return buildLabel(
      "marine",
      spanishName(properties),
      polygonCentroid(feature.geometry),
      properties,
      index,
      {
        minZoom: properties.min_label,
        maxZoom: properties.max_label,
        rank: properties.labelrank ?? properties.scalerank
      }
    );
  });
}

function collectRegions(features) {
  return features.map((feature, index) => {
    const properties = feature.properties ?? {};
    return buildLabel(
      "region",
      spanishName(properties),
      pointCoordinates(feature, "longitude", "latitude"),
      properties,
      index,
      {
        minZoom: properties.min_zoom,
        maxZoom: properties.max_zoom,
        rank: properties.labelrank ?? properties.scalerank
      }
    );
  });
}

const sourceEntries = await Promise.all(
  Object.entries(SOURCES).map(async ([key, fileName]) => [key, await fetchGeoJson(fileName)])
);
const sourceData = Object.fromEntries(sourceEntries);

const labels = [
  ...collectCountries(sourceData.countries.features),
  ...collectAdmin1(sourceData.admin1.features),
  ...collectCities(sourceData.cities.features),
  ...collectMarine(sourceData.marine.features),
  ...collectRegions(sourceData.regions.features)
]
  .filter(Boolean)
  .sort(
    (left, right) =>
      left.minZoom - right.minZoom ||
      left.rank - right.rank ||
      left.kind.localeCompare(right.kind) ||
      left.name.localeCompare(right.name, "es")
  );

const uniqueLabels = [...new Map(labels.map((label) => [label.id, label])).values()].map((label) => ({
  ...label,
  name: SPANISH_NAME_OVERRIDES[label.id] ?? label.name
}));
const catalog = {
  version: 1,
  language: "es",
  source: {
    name: "Natural Earth",
    version: NATURAL_EARTH_VERSION,
    url: `https://github.com/nvkelso/natural-earth-vector/tree/v${NATURAL_EARTH_VERSION}`
  },
  labels: uniqueLabels
};

await writeFile(OUTPUT_URL, `${JSON.stringify(catalog)}\n`, "utf8");
console.log(`Generated ${uniqueLabels.length} Spanish map labels at ${OUTPUT_URL.pathname}`);
