import { useEffect, useRef, useState } from "react";

import {
  type DisasterContext,
  type ExperimentalOrigin,
  type OfficialGeoJsonLayer,
  type OfficialImpactLayerKind,
  type OfficialPagerCity,
  type OfficialPagerSummary,
  type SeismicEvent,
  type SeismicPresenceSummary,
  type SeismicStation
} from "@sismica/shared";
import {
  BillboardGraphics,
  BoundingSphere,
  CallbackProperty,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  CustomDataSource,
  EasingFunction,
  EllipsoidGeodesic,
  Entity,
  GeoJsonDataSource,
  HeadingPitchRange,
  HeightReference,
  HorizontalOrigin,
  Ion,
  JulianDate,
  LabelStyle,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SceneTransforms,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
  defined
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { useSeaLevelStationSeriesQuery } from "../hooks/queries";
import { fetchOfficialImpactSummary, resolveApiEndpoint } from "../lib/api";
import {
  computeCameraShot,
  computeInterEventTransitionPlan,
  computeNarrationRetreatRange,
  type CameraShot
} from "../lib/cameraDirector";
import { resolveCountryCode } from "../lib/countryGeocoder";
import {
  buildCoastalAttentionLayers,
  buildEventHaloLayers,
  type CoastalAttentionLayer,
  type EventHaloLayer
} from "../lib/mapActivity";
import { precacheMapArea } from "../lib/mapCache";
import {
  estimateMapZoom,
  selectNonOverlappingMapLabels,
  selectMapLabelCandidates,
  type ProjectedMapLabel,
  type SpanishMapLabelCatalog,
  type SpanishMapLabelKind
} from "../lib/mapLabels";
import { resolveMapRenderScale } from "../lib/mapQuality";
import {
  buildSeismicSequence,
  selectPrioritySeaLevelStations,
  type PrioritySeaLevelStation,
  type SeismicSequenceMember,
  type SeismicSequenceSummary
} from "../lib/officialImpactMap";
import {
  estimatedIntensity,
  formatDepth,
  formatMagnitude,
  formatUtcDateTime,
  INTENSITY_BANDS,
  MAGNITUDE_BANDS,
  intensityCssColor,
  magnitudeCssColor,
  normalizedIntensity,
  normalizedPlace
} from "../lib/presentation";
import {
  buildSeaLevelSnapshot,
  detectSeaLevelRecentMoves,
  type SeaLevelRecentMove,
  type SeaLevelSnapshotEntry,
  type SeaLevelStation,
  type SeaLevelSeriesPoint,
  type SeaLevelTrend
} from "../lib/seaLevel";
import { playSeismicWaveSound } from "../lib/seismicAudio";
import { getActiveEventNarrationPlayback } from "../lib/seismicVoice";
import { resolveFixedStationPosition, type FixedStationPosition } from "../lib/stationPosition";
import { CountryFlag } from "./CountryFlag";
import { MosaicSwap } from "./MosaicSwap";
import { TopMagnitudeTable } from "./TopMagnitudeTable";

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";

type MapPanelProps = {
  disasters: DisasterContext[];
  events: SeismicEvent[];
  stations: SeismicStation[];
  seaLevelStations: SeaLevelStation[];
  experimentalOrigins: ExperimentalOrigin[];
  seismicPresence: SeismicPresenceSummary | null;
  topMagnitude: SeismicEvent[];
  selectedEventId: string | null;
  soundEnabled: boolean;
  onSelect: (eventId: string) => void;
  tourPaused: boolean;
  onToggleTour: () => void;
};

const VP_MPS = 6500;
const VS_MPS = 3750;
const WAVE_TIME_ACCEL = 35;
const FRESH_WINDOW_MS = 10 * 60 * 1000;
const SELECTION_WAVE_INTERVAL_MS = 3_500;
const SEA_LEVEL_SNAPSHOT_STORAGE_KEY = "sismica:sea-level-snapshot:v1";

const DISASTER_PREFIX = "context:";
const STATION_PREFIX = "station:";
const SEA_LEVEL_STATION_PREFIX = "sea-level:";
const SEA_LEVEL_FIELD_PREFIX = "sea-level-field:";
const SEA_LEVEL_PULSE_PREFIX = "sea-level-pulse:";
const COASTAL_ZONE_PREFIX = "coastal-zone:";
const EXPERIMENTAL_ORIGIN_PREFIX = "origin:";
const WAVE_PREFIX = "wave:";
const MAP_LABEL_PREFIX = "map-label:";
const PAGER_CITY_PREFIX = "pager-city:";
const SEISMIC_SEQUENCE_PREFIX = "seismic-sequence:";

type OfficialAreaIndicator = {
  metric: OfficialImpactLayerKind;
  value: number;
  unit: OfficialGeoJsonLayer["unit"];
  updatedAtUtc: string;
  sourceUrl: string;
  responseCount: number | null;
  standardDeviation: number | null;
  aggregationKm: number | null;
};

const OFFICIAL_AREA_INDICATORS = new WeakMap<Entity, OfficialAreaIndicator>();

type PagerCityIndicator = {
  city: OfficialPagerCity;
  pager: OfficialPagerSummary;
};

type SeismicSequenceIndicator = {
  member: SeismicSequenceMember;
  summary: SeismicSequenceSummary;
};

type ActiveFocusCameraState = {
  eventId: string;
  flightSequence: number;
  focusSphere: BoundingSphere;
  shot: CameraShot;
  mainFlightCompleted: boolean;
  retreatPending: boolean;
  retreatTriggered: boolean;
  startRetreat: (remainingMs: number | null) => void;
};

function clampNarrationRetreatDurationSeconds(remainingMs: number | null): number {
  if (remainingMs === null) return 3.2;
  return CesiumMath.clamp(remainingMs / 1_000, 1.8, 4.2);
}

const PLATE_COLORS: Record<string, string> = {
  subduction: "#d946ef",
  convergent: "#ef4444",
  divergent: "#22c55e",
  transform: "#f59e0b"
};

const STATION_COLORS = {
  unknown: "#64748b",
  online: "#38bdf8",
  delayed: "#facc15",
  offline: "#991b1b",
  triggered: "#84cc16"
} as const;

const SEA_LEVEL_STATION_COLORS = {
  online: "#34d399",
  delayed: "#fbbf24",
  offline: "#64748b"
} as const;

const EXPERIMENTAL_QUALITY_COLORS: Record<ExperimentalOrigin["quality"], string> = {
  acceptable: "#67e8f9",
  preliminary: "#facc15",
  rejected: "#ef4444"
};

const EXPERIMENTAL_STATUS_STROKES: Record<ExperimentalOrigin["status"], string> = {
  candidate: "#fb923c",
  located: "#f8fafc",
  discarded: "#64748b",
  confirmed: "#22c55e"
};

const EXPERIMENTAL_ORIGIN_SYMBOL_CACHE = new Map<string, string>();
const SEA_LEVEL_SYMBOL_CACHE = new Map<string, string>();
const PRIORITY_GLOW_SYMBOL_CACHE = new Map<string, string>();

function numericEntityProperty(entity: Entity, name: string): number | null {
  const property = entity.properties?.[name];
  const raw = property?.getValue(JulianDate.now());
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

function styleOfficialImpactDataSource(
  dataSource: GeoJsonDataSource,
  layer: OfficialGeoJsonLayer,
  sourceUrl: string,
  responseCount: number | null
): void {
  for (const entity of dataSource.entities.values) {
    const value = numericEntityProperty(entity, layer.kind === "dyfi" ? "cdi" : "value");
    if (value === null) continue;

    const baseColor =
      layer.kind === "pga"
        ? Color.fromCssColorString("#22d3ee")
        : layer.kind === "pgv"
          ? Color.fromCssColorString("#fbbf24")
          : Color.fromCssColorString(intensityCssColor(value));
    OFFICIAL_AREA_INDICATORS.set(entity, {
      metric: layer.kind,
      value,
      unit: layer.unit,
      updatedAtUtc: layer.updatedAtUtc,
      sourceUrl,
      responseCount: layer.kind === "dyfi" ? (numericEntityProperty(entity, "nresp") ?? responseCount) : null,
      standardDeviation: layer.kind === "dyfi" ? numericEntityProperty(entity, "stddev") : null,
      aggregationKm: layer.aggregationKm
    });
    if (entity.polygon) {
      entity.polygon.material = new ColorMaterialProperty(
        baseColor.withAlpha(layer.kind === "dyfi" ? 0.34 : 0.18)
      );
      entity.polygon.outline = new ConstantProperty(false);
    }
    if (entity.polyline) {
      entity.polyline.material = new ColorMaterialProperty(
        baseColor.withAlpha(layer.kind === "mmi" ? 0.78 : 0.72)
      );
      entity.polyline.width = new ConstantProperty(layer.kind === "mmi" ? 2.2 : 1.7);
      entity.polyline.clampToGround = new ConstantProperty(true);
    }
  }
}

async function addOfficialImpactDataSource(
  viewer: Viewer,
  layer: OfficialGeoJsonLayer,
  sourceUrl: string,
  responseCount: number | null
): Promise<GeoJsonDataSource> {
  const dataSource = await GeoJsonDataSource.load(resolveApiEndpoint(layer.endpoint), {
    clampToGround: true,
    strokeWidth: layer.kind === "mmi" ? 2.2 : 1.7
  });
  dataSource.name = `impacto-oficial-${layer.kind}`;
  styleOfficialImpactDataSource(dataSource, layer, sourceUrl, responseCount);
  await viewer.dataSources.add(dataSource);
  return dataSource;
}

function readStoredSeaLevelSnapshot(): Record<string, SeaLevelSnapshotEntry> {
  try {
    const raw = localStorage.getItem(SEA_LEVEL_SNAPSHOT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, SeaLevelSnapshotEntry>) : {};
  } catch {
    return {};
  }
}

function writeStoredSeaLevelSnapshot(snapshot: Record<string, SeaLevelSnapshotEntry>): void {
  try {
    localStorage.setItem(SEA_LEVEL_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage no disponible; el monitoreo continua solo en memoria.
  }
}

function magnitudeSize(magnitude: number | null): number {
  if (magnitude === null) return 8;
  return Math.max(8, Math.min(34, magnitude * 5));
}

function priorityGlowSymbol(color: string, selected: boolean, strong: boolean): string {
  const key = `${color}:${selected ? "selected" : strong ? "strong" : "normal"}`;
  const cached = PRIORITY_GLOW_SYMBOL_CACHE.get(key);
  if (cached) return cached;

  const size = selected ? 56 : strong ? 48 : 42;
  const outerRadius = selected ? 22 : strong ? 18 : 15;
  const innerRadius = selected ? 10 : strong ? 8.5 : 7;
  const strokeOpacity = selected ? 0.88 : strong ? 0.68 : 0.56;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${color}" stop-opacity="${selected ? 0.48 : 0.34}"/><stop offset="58%" stop-color="${color}" stop-opacity="${selected ? 0.18 : 0.12}"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient></defs><circle cx="${size / 2}" cy="${size / 2}" r="${outerRadius}" fill="url(#g)"/><circle cx="${size / 2}" cy="${size / 2}" r="${innerRadius}" fill="none" stroke="${color}" stroke-opacity="${strokeOpacity}" stroke-width="${selected ? 2.2 : 1.8}"/></svg>`;
  const symbol = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  PRIORITY_GLOW_SYMBOL_CACHE.set(key, symbol);
  return symbol;
}

function styleEntity(
  entity: Entity,
  event: SeismicEvent,
  selected: boolean,
  halo: EventHaloLayer | null
): void {
  if (!entity.point) return;

  const mmi = estimatedIntensity(event);
  const base = Color.fromCssColorString(intensityCssColor(mmi));
  const baseSize = magnitudeSize(event.magnitude);
  const emphasized = selected || Boolean(halo);

  entity.point.color = new ConstantProperty(base.withAlpha(emphasized ? 1 : 0.92));
  entity.point.outlineColor = new ConstantProperty(
    selected
      ? Color.WHITE.withAlpha(0.96)
      : halo
        ? base.withAlpha(0.74)
        : Color.fromCssColorString("#0b1220").withAlpha(0.9)
  );
  entity.point.outlineWidth = new ConstantProperty(selected ? 3 : halo ? 2.2 : 1.5);

  if (selected) {
    entity.point.pixelSize = new CallbackProperty(
      () => baseSize + 2.4 + Math.sin(Date.now() / 180) * 1.6,
      false
    );
  } else if (halo) {
    entity.point.pixelSize = new ConstantProperty(baseSize + (halo.strong ? 2 : 1.2));
  } else {
    entity.point.pixelSize = new ConstantProperty(baseSize);
  }

  if (!entity.billboard) {
    entity.billboard = new BillboardGraphics();
  }

  if (entity.billboard) {
    if (selected) {
      // Cruz del epicentro coloreada por banda de magnitud (estilo GlobalQuake).
      entity.billboard.image = new ConstantProperty(crossSymbol(gqCrossColor(event.magnitude)));
      entity.billboard.scale = new ConstantProperty(1);
      entity.billboard.horizontalOrigin = new ConstantProperty(HorizontalOrigin.CENTER);
      entity.billboard.verticalOrigin = new ConstantProperty(VerticalOrigin.CENTER);
      entity.billboard.disableDepthTestDistance = new ConstantProperty(Number.POSITIVE_INFINITY);
      entity.billboard.show = new ConstantProperty(true);
    } else if (halo) {
      entity.billboard.image = new ConstantProperty(priorityGlowSymbol(halo.color, false, halo.strong));
      entity.billboard.scale = new ConstantProperty(1);
      entity.billboard.horizontalOrigin = new ConstantProperty(HorizontalOrigin.CENTER);
      entity.billboard.verticalOrigin = new ConstantProperty(VerticalOrigin.CENTER);
      entity.billboard.disableDepthTestDistance = new ConstantProperty(Number.POSITIVE_INFINITY);
      entity.billboard.show = new ConstantProperty(true);
    } else {
      entity.billboard.show = new ConstantProperty(false);
    }
  }

  if (entity.ellipse) {
    entity.ellipse.show = new ConstantProperty(false);
  }
}

function intensityAreaBandLabel(mmi: number): string {
  let selected = INTENSITY_BANDS[0];
  for (const band of INTENSITY_BANDS) {
    if (mmi >= band.mmi) selected = band;
  }
  return selected?.label ?? `MMI ${Math.round(mmi)}`;
}

function disasterColor(level: string | null): Color {
  switch (level?.toLowerCase()) {
    case "red":
      return Color.fromCssColorString("#ff3547");
    case "orange":
      return Color.fromCssColorString("#ff9f1c");
    default:
      return Color.fromCssColorString("#a8d04f");
  }
}

// --- Esquema GlobalQuake por magnitud (replica de FeatureEarthquake.java) ----------
function gqSWaveColor(mag: number): Color {
  const weight = Math.max(0, Math.min(1, (mag - 2) / 4));
  return Color.lerp(
    Color.fromCssColorString("#facc15"),
    Color.fromCssColorString("#ef4444"),
    weight,
    new Color()
  );
}
function gqCrossColor(mag: number | null): Color {
  const m = mag ?? 0;
  if (m < 3) return Color.fromCssColorString("#ffffff");
  if (m < 4) return Color.fromCssColorString("#22c55e");
  if (m < 5) return Color.fromCssColorString("#facc15");
  if (m < 6) return Color.fromCssColorString("#f97316");
  if (m < 7) return Color.fromCssColorString("#ef4444");
  return Color.fromCssColorString("#e879f9");
}
function gqThickness(mag: number | null): number {
  return Math.max(0.3, Math.min(1.6, (mag ?? 3) / 5));
}
// Persistencia de GlobalQuake (2 + 0.01*mag^4 min) traducida a ALCANCE del frente:
// los grandes barren el globo, los chicos quedan locales.
function gqWaveReachM(mag: number | null): number {
  const minutes = 2 + 0.01 * Math.pow(mag ?? 3, 4);
  return Math.max(700_000, Math.min(18_000_000, minutes * 600_000));
}
function crossSymbol(color: Color): string {
  const c = color.toCssColorString();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">` +
    `<g stroke="${c}" stroke-width="3.2" stroke-linecap="round">` +
    `<line x1="6" y1="6" x2="20" y2="20"/><line x1="20" y1="6" x2="6" y2="20"/></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function spawnSeismicRing(
  viewer: Viewer,
  longitude: number,
  latitude: number,
  color: Color,
  velocityMps: number,
  depthM: number,
  outlineWidth: number,
  maxRadiusM: number
): void {
  const start = performance.now();
  let radius = 0;

  const surfaceRadius = () => {
    const realSeconds = ((performance.now() - start) / 1000) * WAVE_TIME_ACCEL;
    const sphere = velocityMps * realSeconds;
    if (sphere <= depthM) return 0;
    return Math.min(maxRadiusM, Math.sqrt(sphere * sphere - depthM * depthM));
  };

  const semiMajorAxis = () => {
    radius = surfaceRadius();
    return Math.max(1, radius);
  };
  const semiMinorAxis = () => Math.max(1, radius - 0.001);
  const fade = () => (radius <= 0 ? 0 : 1 - radius / maxRadiusM);

  const ring = viewer.entities.add({
    id: `${WAVE_PREFIX}${start}-${color.toCssHexString()}-${Math.random().toString(36).slice(2)}`,
    position: Cartesian3.fromDegrees(longitude, latitude),
    ellipse: {
      height: 0,
      semiMajorAxis: new CallbackProperty(semiMajorAxis, false),
      semiMinorAxis: new CallbackProperty(semiMinorAxis, false),
      fill: true,
      material: new ColorMaterialProperty(new CallbackProperty(() => color.withAlpha(fade() * 0.07), false)),
      outline: true,
      outlineColor: new CallbackProperty(() => color.withAlpha(fade() * 0.95), false),
      outlineWidth
    }
  });

  const lifeMs = (Math.sqrt(maxRadiusM ** 2 + depthM ** 2) / velocityMps / WAVE_TIME_ACCEL) * 1000 + 250;
  window.setTimeout(() => {
    if (!viewer.isDestroyed()) viewer.entities.remove(ring);
  }, lifeMs);
}

function spawnWavefront(
  viewer: Viewer,
  event: SeismicEvent,
  soundEnabled: boolean,
  options: { playSound?: boolean } = {}
): void {
  const depthM = Math.max(0, (event.depthKm ?? 0) * 1000);
  const mag = event.magnitude;
  const thick = gqThickness(mag);
  const reachM = gqWaveReachM(mag);

  // Esquema GlobalQuake: onda P azul, onda S amarillo->rojo por magnitud; grosor
  // mag/5; alcance por magnitud (los grandes barren mas globo, los chicos local).
  spawnSeismicRing(
    viewer,
    event.longitude,
    event.latitude,
    Color.fromCssColorString("#3b82f6"),
    VP_MPS,
    depthM,
    2 * thick,
    reachM
  );
  spawnSeismicRing(
    viewer,
    event.longitude,
    event.latitude,
    gqSWaveColor(mag ?? 3),
    VS_MPS,
    depthM,
    3 * thick,
    reachM
  );
  if (options.playSound ?? true) {
    playSeismicWaveSound(event, soundEnabled);
  }
}

function stationSymbol(station: SeismicStation, selected: boolean): string {
  const fill = STATION_COLORS[station.status];
  const stroke = selected
    ? "#ffffff"
    : station.phase === "S"
      ? "#fb923c"
      : station.phase === "P"
        ? "#67e8f9"
        : "#0b1220";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 22 21H2Z" fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 2.5 : 1.5}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function experimentalOriginSymbol(origin: ExperimentalOrigin): string {
  const fill = EXPERIMENTAL_QUALITY_COLORS[origin.quality];
  const stroke = EXPERIMENTAL_STATUS_STROKES[origin.status];
  const key = `${origin.quality}:${origin.status}`;
  const cached = EXPERIMENTAL_ORIGIN_SYMBOL_CACHE.get(key);
  if (cached) return cached;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><polygon points="14,2 26,14 14,26 2,14" fill="${fill}" stroke="${stroke}" stroke-width="2.2"/><circle cx="14" cy="14" r="3.1" fill="#08131b" opacity="0.9"/></svg>`;
  const symbol = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  EXPERIMENTAL_ORIGIN_SYMBOL_CACHE.set(key, symbol);
  return symbol;
}

function experimentalOriginScale(origin: ExperimentalOrigin): number {
  const magnitudeBoost = origin.magnitude === null ? 0 : Math.max(0, Math.min(2.2, origin.magnitude / 4));
  return 0.62 + magnitudeBoost * 0.18;
}

function seaLevelStationSymbol(station: SeaLevelStation, selected: boolean, prioritized = false): string {
  const key = `${station.status}:${selected ? "selected" : prioritized ? "prioritized" : "idle"}`;
  const cached = SEA_LEVEL_SYMBOL_CACHE.get(key);
  if (cached) return cached;

  const fill = SEA_LEVEL_STATION_COLORS[station.status];
  const stroke = selected ? "#ffffff" : prioritized ? "#38bdf8" : "#082032";
  const halo = prioritized
    ? '<circle cx="13" cy="13" r="11" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-opacity="0.9"/>'
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">${halo}<circle cx="13" cy="13" r="7.5" fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 2.8 : prioritized ? 2.5 : 2}"/><path d="M5 16c1.25 0 1.25-.9 2.5-.9s1.25.9 2.5.9 1.25-.9 2.5-.9 1.25.9 2.5.9 1.25-.9 2.5-.9 1.25.9 2.5.9" fill="none" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  const symbol = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  SEA_LEVEL_SYMBOL_CACHE.set(key, symbol);
  return symbol;
}

function formatSeaLevelValue(station: SeaLevelStation): string {
  if (station.lastValue === null) return "Sin lectura publicada";
  const value = new Intl.NumberFormat("es-PE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  }).format(station.lastValue);
  return station.unit ? `${value} ${station.unit}` : value;
}

function formatSeaLevelNumeric(value: number | null, unit: string | null): string {
  if (value === null) return "N/D";
  const formatted = new Intl.NumberFormat("es-PE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatSeaLevelSignedDelta(value: number | null, unit: string | null): string {
  if (value === null) return "N/D";
  const formatted = new Intl.NumberFormat("es-PE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    signDisplay: "always"
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function seaLevelTrendLabel(trend: SeaLevelTrend): string {
  switch (trend) {
    case "rising":
      return "Subiendo";
    case "falling":
      return "Bajando";
    case "stable":
      return "Estable";
    default:
      return "Sin tendencia";
  }
}

function seaLevelTrendColor(trend: SeaLevelTrend): string {
  switch (trend) {
    case "rising":
      return "#22c55e";
    case "falling":
      return "#fb7185";
    case "stable":
      return "#7dd3fc";
    default:
      return "#94a3b8";
  }
}

function buildSeaLevelSparklinePath(points: SeaLevelSeriesPoint[], width: number, height: number): string {
  if (points.length === 0) return "";
  const minValue = Math.min(...points.map((point) => point.value));
  const maxValue = Math.max(...points.map((point) => point.value));
  const valueSpan = Math.max(0.001, maxValue - minValue);
  const denominator = Math.max(1, points.length - 1);

  return points
    .map((point, index) => {
      const x = (index / denominator) * width;
      const y = height - ((point.value - minValue) / valueSpan) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function SeaLevelSparkline({ points, trend }: { points: SeaLevelSeriesPoint[]; trend: SeaLevelTrend }) {
  if (points.length < 2) return null;
  const width = 252;
  const height = 70;
  const path = buildSeaLevelSparklinePath(points, width, height);

  return (
    <div className="sea-level-sparkline">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tendencia reciente del nivel del mar">
        <path d={`M0 ${height / 2} L${width} ${height / 2}`} className="sea-level-sparkline-baseline" />
        <path d={path} className="sea-level-sparkline-line" style={{ stroke: seaLevelTrendColor(trend) }} />
      </svg>
      <span>Ultimas horas en la estacion seleccionada</span>
    </div>
  );
}

function SeaLevelStationDetail({ station, onClose }: { station: SeaLevelStation; onClose: () => void }) {
  const seriesQuery = useSeaLevelStationSeriesQuery(station.stationCode, station.sensor, station.unit, 6);
  const series = seriesQuery.data ?? null;
  const trend = series?.trend ?? "unknown";
  const trendColor = seaLevelTrendColor(trend);

  return (
    <section className="station-detail station-detail-sea-level" aria-label="Detalle de estacion IOC UNESCO">
      <button
        type="button"
        className="station-detail-close"
        onClick={onClose}
        aria-label="Cerrar detalle de estacion de nivel del mar"
        title="Cerrar"
      >
        x
      </button>
      <span className="station-detail-kicker">UNESCO / IOC</span>
      <strong>{station.name}</strong>
      <span>{station.countryName ?? "Pais no publicado"}</span>
      <dl>
        <div>
          <dt>Estado</dt>
          <dd style={{ color: SEA_LEVEL_STATION_COLORS[station.status] }}>{station.status.toUpperCase()}</dd>
        </div>
        <div>
          <dt>Sensor</dt>
          <dd>{station.sensor ?? "N/D"}</dd>
        </div>
        <div>
          <dt>Lectura</dt>
          <dd>
            {series ? formatSeaLevelNumeric(series.latestValue, series.unit) : formatSeaLevelValue(station)}
          </dd>
        </div>
        <div>
          <dt>Tendencia</dt>
          <dd style={{ color: trendColor }}>{seaLevelTrendLabel(trend)}</dd>
        </div>
        <div>
          <dt>Cambio 6 h</dt>
          <dd>{series ? formatSeaLevelSignedDelta(series.changeValue, series.unit) : "Cargando"}</dd>
        </div>
        <div>
          <dt>Rango 6 h</dt>
          <dd>{series ? formatSeaLevelNumeric(series.rangeValue, series.unit) : "Cargando"}</dd>
        </div>
        <div>
          <dt>Ultima obs.</dt>
          <dd>
            {(series?.latestObservationAtUtc ?? station.lastObservationAtUtc)
              ? `${formatUtcDateTime(series?.latestObservationAtUtc ?? station.lastObservationAtUtc ?? "")} UTC`
              : "N/D"}
          </dd>
        </div>
        <div>
          <dt>Conexion</dt>
          <dd>{station.connection ?? "N/D"}</dd>
        </div>
      </dl>
      {seriesQuery.isLoading ? <span className="sea-level-note">Cargando serie reciente...</span> : null}
      {series && series.points.length >= 2 ? (
        <SeaLevelSparkline points={series.points} trend={trend} />
      ) : null}
      {!seriesQuery.isLoading && (!series || series.points.length < 2) ? (
        <span className="sea-level-note">
          No hay suficientes datos recientes para graficar esta estacion.
        </span>
      ) : null}
      <span className="sea-level-note">
        Lectura relativa local. Sirve para monitoreo puntual de la estacion, no para interpolar toda la marea
        del oceano.
      </span>
      <a href={station.sourceUrl} target="_blank" rel="noreferrer">
        Ficha oficial IOC/UNESCO
      </a>
    </section>
  );
}

function formatPresenceCount(count: number): string {
  return new Intl.NumberFormat("es-PE").format(count);
}

function formatPresenceCoverage(summary: SeismicPresenceSummary): string {
  const count = `${formatPresenceCount(summary.totalRecords)} registros`;
  if (summary.startYear === null || summary.endYear === null) return count;
  return `${summary.startYear} - ${summary.endYear} / ${count}`;
}

function SeismicPresenceLegend({ summary }: { summary: SeismicPresenceSummary | null }) {
  return (
    <div className="map-legend legend-presence">
      <div className="presence-heading">
        <span className="legend-title">Paises con mas sismos</span>
        <strong>{summary ? formatPresenceCoverage(summary) : "Cargando"}</strong>
      </div>
      <div className="presence-grid">
        {(summary?.continents ?? []).map((continent) => (
          <section className="presence-continent" key={continent.continentCode}>
            <span>{continent.continentName}</span>
            <ol>
              {continent.countries.length > 0 ? (
                continent.countries.map((country) => (
                  <li key={`${continent.continentCode}-${country.countryCode}`}>
                    <img
                      alt=""
                      aria-hidden="true"
                      className="presence-flag"
                      loading="lazy"
                      src={`/flags/${country.countryCode}.svg`}
                    />
                    <em>{country.countryName}</em>
                    <strong>{formatPresenceCount(country.count)}</strong>
                  </li>
                ))
              ) : (
                <li className="presence-empty">Sin datos</li>
              )}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

async function setupBasemap(viewer: Viewer): Promise<void> {
  if (viewer.isDestroyed()) return;

  // El texto se renderiza por separado desde un catalogo localizado en espanol.
  viewer.imageryLayers.addImageryProvider(
    new UrlTemplateImageryProvider({
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png",
      subdomains: "abcd",
      maximumLevel: 20,
      credit: "(c) OpenStreetMap contributors (c) CARTO"
    })
  );
}

function applyMapRenderQuality(viewer: Viewer): void {
  if (viewer.isDestroyed()) return;
  const canvas = viewer.scene.canvas;
  const scale = resolveMapRenderScale(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = scale.resolutionScale;
  viewer.forceResize();
}

type MapLabelVisual = {
  color: Color;
  font: string;
  fontSize: number;
  outlineWidth: number;
  uppercase: boolean;
};

type PriorityMapLabel = {
  id: string;
  text: string;
  latitude: number;
  longitude: number;
  color: string;
  font: string;
  fontSize: number;
  outlineWidth: number;
};

type MapLabelsController = {
  refresh: () => void;
  cleanup: () => void;
};

type MapLabelCandidate =
  | { kind: "priority"; label: PriorityMapLabel }
  | { kind: "geographic"; label: SpanishMapLabelCatalog["labels"][number]; text: string };

const MAP_LABEL_VISUALS: Record<SpanishMapLabelKind, MapLabelVisual> = {
  country: {
    color: Color.fromCssColorString("#dcecff"),
    font: '700 15px "Bahnschrift Condensed", "Arial Narrow", sans-serif',
    fontSize: 15,
    outlineWidth: 4,
    uppercase: true
  },
  marine: {
    color: Color.fromCssColorString("#8fb7d5"),
    font: 'italic 600 13px "Bahnschrift Condensed", "Arial Narrow", sans-serif',
    fontSize: 13,
    outlineWidth: 4,
    uppercase: true
  },
  region: {
    color: Color.fromCssColorString("#a9c1d3"),
    font: '600 12px "Bahnschrift Condensed", "Arial Narrow", sans-serif',
    fontSize: 12,
    outlineWidth: 3,
    uppercase: false
  },
  admin1: {
    color: Color.fromCssColorString("#c8d8e5"),
    font: '600 13px "Bahnschrift Condensed", "Arial Narrow", sans-serif',
    fontSize: 13,
    outlineWidth: 3,
    uppercase: false
  },
  city: {
    color: Color.WHITE,
    font: '600 12px "Bahnschrift Condensed", "Arial Narrow", sans-serif',
    fontSize: 12,
    outlineWidth: 3,
    uppercase: false
  }
};

function isSpanishMapLabelCatalog(value: unknown): value is SpanishMapLabelCatalog {
  if (!value || typeof value !== "object") return false;
  const catalog = value as Partial<SpanishMapLabelCatalog>;
  return catalog.language === "es" && Array.isArray(catalog.labels);
}

async function setupSpanishMapLabels(
  viewer: Viewer,
  getPriorityLabels: () => readonly PriorityMapLabel[]
): Promise<MapLabelsController> {
  try {
    const response = await fetch("/data/map-labels-es.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog: unknown = await response.json();
    if (!isSpanishMapLabelCatalog(catalog)) throw new Error("Catalogo de etiquetas invalido");
    if (viewer.isDestroyed()) return { refresh: () => undefined, cleanup: () => undefined };

    const dataSource = new CustomDataSource("etiquetas-geograficas-es");
    await viewer.dataSources.add(dataSource);
    if (viewer.isDestroyed()) return { refresh: () => undefined, cleanup: () => undefined };

    const measurementCanvas = document.createElement("canvas");
    const measurementContext = measurementCanvas.getContext("2d");

    let lastSignature = "";
    const refresh = () => {
      if (viewer.isDestroyed()) return;
      const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
      if (!rectangle) return;

      const canvas = viewer.scene.canvas;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;

      const zoom = estimateMapZoom(viewer.camera.positionCartographic.height);
      const geographicCandidates = selectMapLabelCandidates(catalog.labels, {
        zoom,
        bounds: {
          west: CesiumMath.toDegrees(rectangle.west),
          south: CesiumMath.toDegrees(rectangle.south),
          east: CesiumMath.toDegrees(rectangle.east),
          north: CesiumMath.toDegrees(rectangle.north)
        },
        maxCandidates: 550
      });
      const maximumLabels = CesiumMath.clamp(Math.floor((width * height) / 28_000), 24, 76);
      const priorityProjected: ProjectedMapLabel<MapLabelCandidate>[] = getPriorityLabels().flatMap(
        (label) => {
          const screenPosition = SceneTransforms.worldToWindowCoordinates(
            viewer.scene,
            Cartesian3.fromDegrees(label.longitude, label.latitude, 6_000)
          );
          if (!screenPosition) return [];
          if (measurementContext) measurementContext.font = label.font;
          const metrics = measurementContext?.measureText(label.text);
          const measuredHeight = metrics
            ? metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
            : label.fontSize;
          return [
            {
              value: { kind: "priority" as const, label },
              x: screenPosition.x,
              y: screenPosition.y,
              width: Math.ceil(
                (metrics?.width ?? label.text.length * label.fontSize * 0.6) + label.outlineWidth * 2
              ),
              height: Math.ceil(Math.max(label.fontSize, measuredHeight) + label.outlineWidth * 2)
            }
          ];
        }
      );
      const geographicProjected: ProjectedMapLabel<MapLabelCandidate>[] = geographicCandidates.flatMap(
        (label) => {
          const screenPosition = SceneTransforms.worldToWindowCoordinates(
            viewer.scene,
            Cartesian3.fromDegrees(label.longitude, label.latitude, 3_000)
          );
          if (!screenPosition) return [];

          const visual = MAP_LABEL_VISUALS[label.kind];
          const text = visual.uppercase ? label.name.toLocaleUpperCase("es") : label.name;
          if (measurementContext) measurementContext.font = visual.font;
          const metrics = measurementContext?.measureText(text);
          const measuredHeight = metrics
            ? metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
            : visual.fontSize;

          return [
            {
              value: { kind: "geographic" as const, label, text },
              x: screenPosition.x,
              y: screenPosition.y,
              width: Math.ceil(
                (metrics?.width ?? text.length * visual.fontSize * 0.6) + visual.outlineWidth * 2
              ),
              height: Math.ceil(Math.max(visual.fontSize, measuredHeight) + visual.outlineWidth * 2)
            }
          ];
        }
      );
      const visible = selectNonOverlappingMapLabels<MapLabelCandidate>(
        [...priorityProjected, ...geographicProjected],
        {
          viewportWidth: width,
          viewportHeight: height,
          maxLabels: maximumLabels,
          minimumGap: zoom < 3 ? 12 : 9,
          viewportPadding: 8
        }
      );

      const signature = visible
        .map(({ value }) =>
          value.kind === "priority" ? `${value.label.id}:${value.label.text}` : value.label.id
        )
        .join("|");
      if (signature === lastSignature) return;
      lastSignature = signature;

      dataSource.entities.suspendEvents();
      dataSource.entities.removeAll();
      for (const { value } of visible) {
        if (value.kind === "priority") {
          const { label } = value;
          dataSource.entities.add({
            id: label.id,
            position: Cartesian3.fromDegrees(label.longitude, label.latitude, 6_000),
            label: {
              text: label.text,
              font: label.font,
              fillColor: Color.fromCssColorString(label.color),
              outlineColor: Color.BLACK.withAlpha(0.96),
              outlineWidth: label.outlineWidth,
              style: LabelStyle.FILL_AND_OUTLINE,
              horizontalOrigin: HorizontalOrigin.CENTER,
              verticalOrigin: VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
          });
        } else {
          const { label, text } = value;
          const visual = MAP_LABEL_VISUALS[label.kind];
          dataSource.entities.add({
            id: `${MAP_LABEL_PREFIX}${label.id}`,
            position: Cartesian3.fromDegrees(label.longitude, label.latitude, 3_000),
            label: {
              text,
              font: visual.font,
              fillColor: visual.color,
              outlineColor: Color.BLACK.withAlpha(0.92),
              outlineWidth: visual.outlineWidth,
              style: LabelStyle.FILL_AND_OUTLINE,
              horizontalOrigin: HorizontalOrigin.CENTER,
              verticalOrigin: VerticalOrigin.CENTER
            }
          });
        }
      }
      dataSource.entities.resumeEvents();
      viewer.scene.requestRender();
    };

    const removeMoveListener = viewer.camera.moveEnd.addEventListener(refresh);
    window.addEventListener("resize", refresh);
    const refreshTimer = window.setInterval(refresh, 1_500);
    void document.fonts.ready.then(refresh);
    refresh();

    return {
      refresh,
      cleanup: () => {
        removeMoveListener();
        window.removeEventListener("resize", refresh);
        window.clearInterval(refreshTimer);
        if (!viewer.isDestroyed() && viewer.dataSources.contains(dataSource)) {
          viewer.dataSources.remove(dataSource, true);
        }
      }
    };
  } catch (error) {
    console.warn("No se pudieron cargar las etiquetas geograficas en espanol.", error);
    return { refresh: () => undefined, cleanup: () => undefined };
  }
}

async function loadCountryBorders(viewer: Viewer): Promise<void> {
  try {
    const dataSource = await GeoJsonDataSource.load("/data/countries.geojson", {
      stroke: Color.fromCssColorString("#5b7690"),
      fill: Color.fromCssColorString("#000000").withAlpha(0),
      strokeWidth: 1.2,
      clampToGround: false
    });

    if (viewer.isDestroyed()) return;

    for (const entity of dataSource.entities.values) {
      if (!entity.polygon) continue;
      entity.polygon.fill = new ConstantProperty(false);
      entity.polygon.outline = new ConstantProperty(true);
      entity.polygon.outlineColor = new ConstantProperty(Color.fromCssColorString("#6b86a3").withAlpha(0.5));
      entity.polygon.outlineWidth = new ConstantProperty(1);
      entity.polygon.height = new ConstantProperty(0);
    }

    await viewer.dataSources.add(dataSource);
  } catch (error) {
    console.warn("No se pudieron cargar las fronteras de paises.", error);
  }
}

async function loadPlateBoundaries(viewer: Viewer): Promise<void> {
  try {
    const dataSource = await GeoJsonDataSource.load("/data/plate-boundaries-typed.geojson", {
      clampToGround: true,
      strokeWidth: 2
    });

    if (viewer.isDestroyed()) return;

    const now = JulianDate.now();
    for (const entity of dataSource.entities.values) {
      if (!entity.polyline) continue;
      const props = entity.properties as unknown as { kind?: { getValue: (t: JulianDate) => string } };
      const kind = props?.kind?.getValue(now);
      const css = (kind && PLATE_COLORS[kind]) || "#94a3b8";
      entity.polyline.material = new ColorMaterialProperty(Color.fromCssColorString(css).withAlpha(0.9));
      entity.polyline.width = new ConstantProperty(2);
    }

    await viewer.dataSources.add(dataSource);
  } catch (error) {
    console.warn("No se pudieron cargar las placas tectonicas.", error);
  }
}

async function loadActiveFaults(viewer: Viewer): Promise<void> {
  try {
    const dataSource = await GeoJsonDataSource.load("/data/gem_active_faults.geojson", {
      clampToGround: true,
      strokeWidth: 1
    });

    if (viewer.isDestroyed()) return;

    for (const entity of dataSource.entities.values) {
      if (!entity.polyline) continue;
      entity.polyline.material = new ColorMaterialProperty(
        Color.fromCssColorString("#dc2626").withAlpha(0.3)
      );
      entity.polyline.width = new ConstantProperty(1);
    }

    await viewer.dataSources.add(dataSource);
  } catch (error) {
    console.warn("No se pudieron cargar las fallas activas.", error);
  }
}

async function loadVolcanoes(viewer: Viewer): Promise<void> {
  try {
    const dataSource = await GeoJsonDataSource.load("/data/volcanoes.geojson");

    if (viewer.isDestroyed()) return;

    const volcanoSvg =
      'data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" fill="%23f97316" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/></svg>';

    for (const entity of dataSource.entities.values) {
      if (!entity.position) continue;
      entity.billboard = new BillboardGraphics({
        image: new ConstantProperty(volcanoSvg),
        scale: new ConstantProperty(0.7),
        horizontalOrigin: new ConstantProperty(HorizontalOrigin.CENTER),
        verticalOrigin: new ConstantProperty(VerticalOrigin.BOTTOM)
      });
      entity.point = undefined;
      entity.cylinder = undefined;
    }

    await viewer.dataSources.add(dataSource);
  } catch (error) {
    console.warn("No se pudieron cargar los volcanes.", error);
  }
}

export function MapPanel({
  disasters,
  events,
  stations,
  seaLevelStations,
  experimentalOrigins,
  seismicPresence,
  topMagnitude,
  selectedEventId,
  soundEnabled,
  onSelect,
  tourPaused,
  onToggleTour
}: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const eventMapRef = useRef<Map<string, SeismicEvent>>(new Map());
  const stationMapRef = useRef<Map<string, SeismicStation>>(new Map());
  const fixedStationPositionRef = useRef<Map<string, FixedStationPosition>>(new Map());
  const seaLevelStationMapRef = useRef<Map<string, SeaLevelStation>>(new Map());
  const prioritySeaLevelStationMapRef = useRef<Map<string, PrioritySeaLevelStation>>(new Map());
  const seaLevelSnapshotRef = useRef<Record<string, SeaLevelSnapshotEntry>>({});
  const experimentalOriginMapRef = useRef<Map<string, ExperimentalOrigin>>(new Map());
  const disasterMapRef = useRef<Map<string, DisasterContext>>(new Map());
  const coastalZoneMapRef = useRef<Map<string, CoastalAttentionLayer>>(new Map());
  const eventHaloMapRef = useRef<Map<string, EventHaloLayer>>(new Map());
  const pagerCityMapRef = useRef<Map<string, PagerCityIndicator>>(new Map());
  const sequenceMapRef = useRef<Map<string, SeismicSequenceIndicator>>(new Map());
  const pagerPriorityLabelsRef = useRef<PriorityMapLabel[]>([]);
  const sequencePriorityLabelsRef = useRef<PriorityMapLabel[]>([]);
  const mapLabelRefreshRef = useRef<(() => void) | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const selectedIdRef = useRef<string | null>(selectedEventId);
  const stopSpinRef = useRef<(() => void) | null>(null);
  const selectionWaveTimerRef = useRef<number | null>(null);
  const cameraFlightSequenceRef = useRef(0);
  const activeFocusCameraRef = useRef<ActiveFocusCameraState | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [hover, setHover] = useState<
    | { kind: "event"; event: SeismicEvent; x: number; y: number }
    | { kind: "disaster"; context: DisasterContext; x: number; y: number }
    | { kind: "station"; station: SeismicStation; x: number; y: number }
    | {
        kind: "sea-level";
        station: SeaLevelStation;
        priorityDistanceKm: number | null;
        x: number;
        y: number;
      }
    | { kind: "origin"; origin: ExperimentalOrigin; x: number; y: number }
    | { kind: "coastal-zone"; layer: CoastalAttentionLayer; x: number; y: number }
    | { kind: "pager-city"; indicator: PagerCityIndicator; x: number; y: number }
    | { kind: "sequence"; indicator: SeismicSequenceIndicator; x: number; y: number }
    | { kind: "official-area"; indicator: OfficialAreaIndicator; x: number; y: number }
    | { kind: "volcano"; name: string; country: string; type: string; x: number; y: number }
    | null
  >(null);
  const [stationsVisible] = useState(true);
  const [seaLevelStationsVisible] = useState(true);
  const [experimentalOriginsVisible] = useState(true);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedSeaLevelStationId, setSelectedSeaLevelStationId] = useState<string | null>(null);
  const [seaLevelRecentMoves, setSeaLevelRecentMoves] = useState<SeaLevelRecentMove[]>([]);

  useEffect(() => {
    seaLevelSnapshotRef.current = readStoredSeaLevelSnapshot();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new Viewer(containerRef.current, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      useBrowserRecommendedResolution: false
    });
    viewerRef.current = viewer;

    const scene = viewer.scene;
    scene.globe.enableLighting = true;
    scene.globe.showGroundAtmosphere = true;
    scene.globe.depthTestAgainstTerrain = false;
    scene.globe.baseColor = Color.fromCssColorString("#0b1220");
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    scene.fog.enabled = false;
    scene.highDynamicRange = false;
    scene.postProcessStages.bloom.enabled = false;

    const refreshMapQuality = () => applyMapRenderQuality(viewer);
    const qualityResizeObserver = new ResizeObserver(refreshMapQuality);
    qualityResizeObserver.observe(containerRef.current);
    window.addEventListener("resize", refreshMapQuality);
    refreshMapQuality();

    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(-40, 15, 32_000_000)
    });

    const spin = () => viewer.scene.camera.rotate(Cartesian3.UNIT_Z, -0.0009);
    viewer.clock.onTick.addEventListener(spin);
    const stopSpin = () => viewer.clock.onTick.removeEventListener(spin);
    stopSpinRef.current = stopSpin;
    viewer.scene.canvas.addEventListener("pointerdown", stopSpin, { once: true });

    const canvas = viewer.scene.canvas;
    const handler = new ScreenSpaceEventHandler(canvas);

    handler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.drillPick(movement.position, 12).find((candidate) => {
        if (!(candidate.id instanceof Entity) || candidate.id.id.startsWith(MAP_LABEL_PREFIX)) return false;
        const id = candidate.id.id;
        return (
          eventMapRef.current.has(id) ||
          coastalZoneMapRef.current.has(id) ||
          stationMapRef.current.has(id) ||
          seaLevelStationMapRef.current.has(id) ||
          sequenceMapRef.current.has(id)
        );
      });
      if (!defined(picked) || !(picked.id instanceof Entity) || typeof picked.id.id !== "string") return;
      if (eventMapRef.current.has(picked.id.id)) {
        setSelectedStationId(null);
        setSelectedSeaLevelStationId(null);
        onSelectRef.current(picked.id.id);
      } else if (coastalZoneMapRef.current.has(picked.id.id)) {
        const layer = coastalZoneMapRef.current.get(picked.id.id);
        if (!layer) return;
        setSelectedStationId(null);
        setSelectedSeaLevelStationId(null);
        onSelectRef.current(layer.eventId);
      } else if (stationMapRef.current.has(picked.id.id)) {
        setSelectedSeaLevelStationId(null);
        setSelectedStationId(picked.id.id);
      } else if (seaLevelStationMapRef.current.has(picked.id.id)) {
        setSelectedStationId(null);
        setSelectedSeaLevelStationId(picked.id.id);
      } else if (sequenceMapRef.current.has(picked.id.id)) {
        const indicator = sequenceMapRef.current.get(picked.id.id);
        if (indicator) onSelectRef.current(indicator.member.event.eventId);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement: ScreenSpaceEventHandler.MotionEvent) => {
      const candidates = viewer.scene.drillPick(movement.endPosition, 12);
      const primary = candidates.find((candidate) => {
        if (!(candidate.id instanceof Entity) || candidate.id.id.startsWith(MAP_LABEL_PREFIX)) return false;
        const id = candidate.id.id;
        return (
          eventMapRef.current.has(id) ||
          disasterMapRef.current.has(id) ||
          stationMapRef.current.has(id) ||
          seaLevelStationMapRef.current.has(id) ||
          experimentalOriginMapRef.current.has(id) ||
          coastalZoneMapRef.current.has(id) ||
          pagerCityMapRef.current.has(id) ||
          sequenceMapRef.current.has(id)
        );
      });
      const contextual = candidates.find(
        (candidate) =>
          candidate.id instanceof Entity &&
          !candidate.id.id.startsWith(MAP_LABEL_PREFIX) &&
          (OFFICIAL_AREA_INDICATORS.has(candidate.id) || Boolean(candidate.id.properties?.volcanoName))
      );
      const picked = primary ?? contextual;
      const entity = defined(picked) && picked.id instanceof Entity ? picked.id : undefined;
      const id = entity?.id;
      const event = typeof id === "string" ? eventMapRef.current.get(id) : undefined;
      const context = typeof id === "string" ? disasterMapRef.current.get(id) : undefined;
      const station = typeof id === "string" ? stationMapRef.current.get(id) : undefined;
      const seaLevelStation = typeof id === "string" ? seaLevelStationMapRef.current.get(id) : undefined;
      const prioritySeaLevelStation =
        typeof id === "string" ? prioritySeaLevelStationMapRef.current.get(id) : undefined;
      const origin = typeof id === "string" ? experimentalOriginMapRef.current.get(id) : undefined;
      const coastalLayer = typeof id === "string" ? coastalZoneMapRef.current.get(id) : undefined;
      const pagerCity = typeof id === "string" ? pagerCityMapRef.current.get(id) : undefined;
      const sequence = typeof id === "string" ? sequenceMapRef.current.get(id) : undefined;
      const officialArea = entity ? OFFICIAL_AREA_INDICATORS.get(entity) : undefined;

      const rect = canvas.getBoundingClientRect();
      if (event) {
        setHover({
          kind: "event",
          event,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "pointer";
      } else if (context) {
        setHover({
          kind: "disaster",
          context,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "pointer";
      } else if (station) {
        setHover({
          kind: "station",
          station,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "pointer";
      } else if (seaLevelStation) {
        setHover({
          kind: "sea-level",
          station: seaLevelStation,
          priorityDistanceKm: prioritySeaLevelStation?.distanceKm ?? null,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "pointer";
      } else if (origin) {
        setHover({
          kind: "origin",
          origin,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "default";
      } else if (coastalLayer) {
        setHover({
          kind: "coastal-zone",
          layer: coastalLayer,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "pointer";
      } else if (pagerCity) {
        setHover({
          kind: "pager-city",
          indicator: pagerCity,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "help";
      } else if (sequence) {
        setHover({
          kind: "sequence",
          indicator: sequence,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "pointer";
      } else if (officialArea) {
        setHover({
          kind: "official-area",
          indicator: officialArea,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "help";
      } else if (entity?.properties?.volcanoName) {
        setHover({
          kind: "volcano",
          name: entity.properties.volcanoName.getValue()?.toString() || "Volcan",
          country: entity.properties.country?.getValue()?.toString() || "",
          type: entity.properties.type?.getValue()?.toString() || "",
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "pointer";
      } else {
        setHover((prev) => (prev ? null : prev));
        canvas.style.cursor = "default";
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    const clearHover = () => setHover((prev) => (prev ? null : prev));
    canvas.addEventListener("pointerleave", clearHover);

    let disposed = false;
    let cleanupSpanishLabels: () => void = () => undefined;

    void setupBasemap(viewer);
    void setupSpanishMapLabels(viewer, () => [
      ...pagerPriorityLabelsRef.current,
      ...sequencePriorityLabelsRef.current
    ]).then((controller) => {
      if (disposed) controller.cleanup();
      else {
        mapLabelRefreshRef.current = controller.refresh;
        cleanupSpanishLabels = controller.cleanup;
        controller.refresh();
      }
    });
    void loadCountryBorders(viewer);
    void loadPlateBoundaries(viewer);
    void loadActiveFaults(viewer);
    void loadVolcanoes(viewer);

    return () => {
      disposed = true;
      cameraFlightSequenceRef.current += 1;
      if (selectionWaveTimerRef.current !== null) {
        window.clearInterval(selectionWaveTimerRef.current);
        selectionWaveTimerRef.current = null;
      }
      stopSpin();
      stopSpinRef.current = null;
      qualityResizeObserver.disconnect();
      window.removeEventListener("resize", refreshMapQuality);
      cleanupSpanishLabels();
      mapLabelRefreshRef.current = null;
      canvas.removeEventListener("pointerleave", clearHover);
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const collection = viewer.entities;
    const nextMap = new Map(events.map((event) => [event.eventId, event]));
    const haloMap = new Map(
      buildEventHaloLayers(events, selectedIdRef.current, Date.now()).map(
        (halo) => [halo.eventId, halo] as const
      )
    );
    eventMapRef.current = nextMap;
    eventHaloMapRef.current = haloMap;
    const firstLoad = !initializedRef.current;

    collection.suspendEvents();

    for (const entity of [...collection.values]) {
      if (
        typeof entity.id === "string" &&
        (entity.id.startsWith(WAVE_PREFIX) ||
          entity.id.startsWith(SEA_LEVEL_FIELD_PREFIX) ||
          entity.id.startsWith(SEA_LEVEL_PULSE_PREFIX) ||
          entity.id.startsWith(COASTAL_ZONE_PREFIX) ||
          entity.id.startsWith(DISASTER_PREFIX) ||
          entity.id.startsWith(STATION_PREFIX) ||
          entity.id.startsWith(SEA_LEVEL_STATION_PREFIX) ||
          entity.id.startsWith(EXPERIMENTAL_ORIGIN_PREFIX) ||
          entity.id.startsWith(SEISMIC_SEQUENCE_PREFIX))
      ) {
        continue;
      }
      if (typeof entity.id === "string" && !nextMap.has(entity.id)) {
        collection.remove(entity);
      }
    }

    for (const event of events) {
      const selected = event.eventId === selectedIdRef.current;
      let entity = collection.getById(event.eventId);
      if (!entity) {
        entity = collection.add({
          id: event.eventId,
          position: Cartesian3.fromDegrees(event.longitude, event.latitude),
          point: {}
        });
      } else {
        entity.position = new ConstantPositionProperty(
          Cartesian3.fromDegrees(event.longitude, event.latitude)
        );
      }

      styleEntity(entity, event, selected, haloMap.get(event.eventId) ?? null);

      const isNew = !seenIdsRef.current.has(event.eventId);
      seenIdsRef.current.add(event.eventId);
      const isFresh = Date.now() - Date.parse(event.eventTimeUtc) < FRESH_WINDOW_MS;
      if (!firstLoad && isNew && isFresh) {
        spawnWavefront(viewer, event, soundEnabled);
      }
    }

    collection.resumeEvents();
    initializedRef.current = true;
  }, [events, soundEnabled]);

  useEffect(() => {
    if (!selectedEventId) return;
    const event = events.find((candidate) => candidate.eventId === selectedEventId);
    if (!event) return;

    void precacheMapArea(event.latitude, event.longitude);
  }, [events, selectedEventId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    for (const entity of [...viewer.entities.values]) {
      if (typeof entity.id === "string" && entity.id.startsWith(SEISMIC_SEQUENCE_PREFIX)) {
        viewer.entities.remove(entity);
      }
    }
    sequenceMapRef.current = new Map();
    sequencePriorityLabelsRef.current = [];

    const sequence = buildSeismicSequence(events, selectedEventId);
    if (!sequence) {
      mapLabelRefreshRef.current?.();
      return;
    }

    const indicators = new Map<string, SeismicSequenceIndicator>();
    const principalId = `${SEISMIC_SEQUENCE_PREFIX}principal:${sequence.principal.event.eventId}`;
    const principalColor = Color.fromCssColorString("#38bdf8");
    viewer.entities.add({
      id: principalId,
      position: Cartesian3.fromDegrees(sequence.principal.event.longitude, sequence.principal.event.latitude),
      ellipse: {
        semiMajorAxis: 24_000,
        semiMinorAxis: 24_000,
        height: 0,
        fill: false,
        outline: true,
        outlineColor: principalColor.withAlpha(0.94),
        outlineWidth: 3
      }
    });
    indicators.set(principalId, { member: sequence.principal, summary: sequence });

    for (const member of sequence.posterior) {
      const id = `${SEISMIC_SEQUENCE_PREFIX}posterior:${member.event.eventId}`;
      viewer.entities.add({
        id,
        position: Cartesian3.fromDegrees(member.event.longitude, member.event.latitude),
        ellipse: {
          semiMajorAxis: 12_000,
          semiMinorAxis: 12_000,
          height: 0,
          fill: false,
          outline: true,
          outlineColor: Color.fromCssColorString("#fbbf24").withAlpha(0.82),
          outlineWidth: 2
        }
      });
      indicators.set(id, { member, summary: sequence });
    }
    sequenceMapRef.current = indicators;
    sequencePriorityLabelsRef.current = [
      {
        id: principalId,
        text: `Evento principal · 6 h: ${sequence.count6h} · 24 h: ${sequence.count24h}`,
        latitude: sequence.principal.event.latitude,
        longitude: sequence.principal.event.longitude,
        color: "#bae6fd",
        font: '700 12px "Bahnschrift Condensed", "Arial Narrow", sans-serif',
        fontSize: 12,
        outlineWidth: 4
      }
    ];
    mapLabelRefreshRef.current?.();

    return () => {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      for (const entity of [...viewerRef.current.entities.values]) {
        if (typeof entity.id === "string" && entity.id.startsWith(SEISMIC_SEQUENCE_PREFIX)) {
          viewerRef.current.entities.remove(entity);
        }
      }
      sequenceMapRef.current = new Map();
      sequencePriorityLabelsRef.current = [];
      mapLabelRefreshRef.current?.();
    };
  }, [events, selectedEventId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const nextMap = new Map<string, CoastalAttentionLayer>(
      buildCoastalAttentionLayers(events, selectedEventId, Date.now()).map(
        (layer) => [`${COASTAL_ZONE_PREFIX}${layer.areaId}`, layer] as const
      )
    );
    coastalZoneMapRef.current = nextMap;

    for (const entity of [...viewer.entities.values]) {
      if (
        typeof entity.id === "string" &&
        entity.id.startsWith(COASTAL_ZONE_PREFIX) &&
        !nextMap.has(entity.id)
      ) {
        viewer.entities.remove(entity);
      }
    }

    for (const [id, layer] of nextMap) {
      let entity = viewer.entities.getById(id);
      if (!entity) {
        entity = viewer.entities.add({
          id,
          polyline: {}
        });
      }
      if (!entity.polyline) continue;

      const phase =
        ((layer.pathPoints[0]?.latitude ?? 0) * 13 + (layer.pathPoints[0]?.longitude ?? 0) * 7) *
        (Math.PI / 180);
      const coastalColor = Color.fromCssColorString(layer.color);
      const positions = layer.pathPoints.map((point) =>
        Cartesian3.fromDegrees(point.longitude, point.latitude)
      );
      entity.polyline.positions = new ConstantProperty(positions);
      entity.polyline.clampToGround = new ConstantProperty(true);
      entity.polyline.width = new CallbackProperty(
        () => 4.2 + layer.emphasis * 1.6 + Math.sin(Date.now() / 1_120 + phase) * 0.42,
        false
      );
      entity.polyline.material = new ColorMaterialProperty(
        new CallbackProperty(
          () =>
            coastalColor.withAlpha(
              (layer.tsunami ? 0.62 : 0.42) + Math.sin(Date.now() / 1_280 + phase) * 0.03
            ),
          false
        )
      );
      entity.polyline.show = new ConstantProperty(true);
    }
  }, [events, selectedEventId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const nextMap = new Map(stations.map((station) => [`${STATION_PREFIX}${station.stationId}`, station]));
    stationMapRef.current = nextMap;

    for (const entity of [...viewer.entities.values]) {
      if (typeof entity.id === "string" && entity.id.startsWith(STATION_PREFIX) && !nextMap.has(entity.id)) {
        viewer.entities.remove(entity);
        fixedStationPositionRef.current.delete(entity.id);
      }
    }

    for (const [id, station] of nextMap) {
      const { position: fixedPosition, ignoredChange } = resolveFixedStationPosition(
        fixedStationPositionRef.current,
        id,
        station
      );
      if (ignoredChange) {
        console.warn(`Se ignoro un desplazamiento de la estacion fija ${station.stationId}.`);
      }
      let entity = viewer.entities.getById(id);
      if (!entity) {
        entity = viewer.entities.add({
          id,
          position: Cartesian3.fromDegrees(fixedPosition.longitude, fixedPosition.latitude),
          billboard: {}
        });
      }

      if (entity.billboard) {
        const selected = id === selectedStationId;
        entity.billboard.image = new ConstantProperty(stationSymbol(station, selected));
        entity.billboard.scale = new ConstantProperty(selected ? 0.95 : 0.68);
        entity.billboard.horizontalOrigin = new ConstantProperty(HorizontalOrigin.CENTER);
        entity.billboard.verticalOrigin = new ConstantProperty(VerticalOrigin.CENTER);
        // Las estaciones usan la coordenada geodesica fija del catalogo. Clampear cada
        // billboard al terreno hace que Cesium lo recoloque mientras resuelve teselas.
        entity.billboard.heightReference = new ConstantProperty(HeightReference.NONE);
        entity.billboard.disableDepthTestDistance = new ConstantProperty(0);
        entity.billboard.show = new ConstantProperty(stationsVisible);
      }
    }
  }, [stations, stationsVisible, selectedStationId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const selectedEvent =
      (selectedEventId ? events.find((event) => event.eventId === selectedEventId) : null) ?? null;
    const priorityStations = selectPrioritySeaLevelStations(selectedEvent, seaLevelStations);
    const priorityMap = new Map(
      priorityStations.map((entry) => [`${SEA_LEVEL_STATION_PREFIX}${entry.station.stationCode}`, entry])
    );
    prioritySeaLevelStationMapRef.current = priorityMap;

    const previousSnapshot = seaLevelSnapshotRef.current;
    const moves = detectSeaLevelRecentMoves(seaLevelStations, previousSnapshot);
    setSeaLevelRecentMoves(moves.slice(0, 8));

    const nextSnapshot = buildSeaLevelSnapshot(seaLevelStations);
    seaLevelSnapshotRef.current = nextSnapshot;
    writeStoredSeaLevelSnapshot(nextSnapshot);

    const nextMap = new Map(
      seaLevelStations.map((station) => [`${SEA_LEVEL_STATION_PREFIX}${station.stationCode}`, station])
    );
    seaLevelStationMapRef.current = nextMap;

    for (const entity of [...viewer.entities.values]) {
      if (
        typeof entity.id === "string" &&
        entity.id.startsWith(SEA_LEVEL_STATION_PREFIX) &&
        !nextMap.has(entity.id)
      ) {
        viewer.entities.remove(entity);
      }
    }

    for (const [id, station] of nextMap) {
      let entity = viewer.entities.getById(id);
      if (!entity) {
        entity = viewer.entities.add({
          id,
          position: Cartesian3.fromDegrees(station.longitude, station.latitude),
          billboard: {}
        });
      } else {
        entity.position = new ConstantPositionProperty(
          Cartesian3.fromDegrees(station.longitude, station.latitude)
        );
      }

      if (entity.billboard) {
        const selected = id === selectedSeaLevelStationId;
        const prioritized = priorityMap.has(id);
        entity.billboard.image = new ConstantProperty(seaLevelStationSymbol(station, selected, prioritized));
        entity.billboard.scale = new ConstantProperty(selected ? 0.88 : prioritized ? 0.82 : 0.62);
        entity.billboard.horizontalOrigin = new ConstantProperty(HorizontalOrigin.CENTER);
        entity.billboard.verticalOrigin = new ConstantProperty(VerticalOrigin.CENTER);
        entity.billboard.heightReference = new ConstantProperty(HeightReference.CLAMP_TO_GROUND);
        entity.billboard.disableDepthTestDistance = new ConstantProperty(0);
        entity.billboard.show = new ConstantProperty(seaLevelStationsVisible);
      }
    }
  }, [events, seaLevelStations, seaLevelStationsVisible, selectedEventId, selectedSeaLevelStationId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    for (const entity of [...viewer.entities.values]) {
      if (
        typeof entity.id === "string" &&
        (entity.id.startsWith(SEA_LEVEL_FIELD_PREFIX) || entity.id.startsWith(SEA_LEVEL_PULSE_PREFIX))
      ) {
        viewer.entities.remove(entity);
      }
    }
  }, [seaLevelRecentMoves]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const nextMap = new Map(
      experimentalOrigins.map((origin) => [`${EXPERIMENTAL_ORIGIN_PREFIX}${origin.originId}`, origin])
    );
    experimentalOriginMapRef.current = nextMap;

    for (const entity of [...viewer.entities.values]) {
      if (
        typeof entity.id === "string" &&
        entity.id.startsWith(EXPERIMENTAL_ORIGIN_PREFIX) &&
        !nextMap.has(entity.id)
      ) {
        viewer.entities.remove(entity);
      }
    }

    for (const [id, origin] of nextMap) {
      let entity = viewer.entities.getById(id);
      if (!entity) {
        entity = viewer.entities.add({
          id,
          position: Cartesian3.fromDegrees(origin.longitude, origin.latitude),
          billboard: {}
        });
      } else {
        entity.position = new ConstantPositionProperty(
          Cartesian3.fromDegrees(origin.longitude, origin.latitude)
        );
      }

      if (entity.billboard) {
        entity.billboard.image = new ConstantProperty(experimentalOriginSymbol(origin));
        entity.billboard.scale = new ConstantProperty(experimentalOriginScale(origin));
        entity.billboard.horizontalOrigin = new ConstantProperty(HorizontalOrigin.CENTER);
        entity.billboard.verticalOrigin = new ConstantProperty(VerticalOrigin.CENTER);
        entity.billboard.disableDepthTestDistance = new ConstantProperty(Number.POSITIVE_INFINITY);
        entity.billboard.show = new ConstantProperty(experimentalOriginsVisible);
      }
    }
  }, [experimentalOrigins, experimentalOriginsVisible]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const nextMap = new Map(disasters.map((context) => [`${DISASTER_PREFIX}${context.contextId}`, context]));
    disasterMapRef.current = nextMap;

    for (const entity of [...viewer.entities.values]) {
      if (typeof entity.id === "string" && entity.id.startsWith(DISASTER_PREFIX) && !nextMap.has(entity.id)) {
        viewer.entities.remove(entity);
      }
    }

    for (const [id, context] of nextMap) {
      let entity = viewer.entities.getById(id);
      if (!entity) {
        entity = viewer.entities.add({
          id,
          position: Cartesian3.fromDegrees(context.longitude, context.latitude),
          point: {}
        });
      }
      if (entity.point) {
        entity.point.pixelSize = new ConstantProperty(15);
        entity.point.color = new ConstantProperty(disasterColor(context.alertLevel).withAlpha(0.95));
        entity.point.outlineColor = new ConstantProperty(Color.WHITE.withAlpha(0.9));
        entity.point.outlineWidth = new ConstantProperty(2);
      }
    }
  }, [disasters]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const focusState = activeFocusCameraRef.current;
      const viewer = viewerRef.current;
      if (!focusState || !viewer || viewer.isDestroyed() || focusState.retreatTriggered) return;

      const playback = getActiveEventNarrationPlayback();
      if (!playback || playback.engine !== "chatterbox" || playback.eventId !== focusState.eventId) return;
      if (playback.durationMs === null || playback.durationMs <= 0) return;
      if (playback.currentTimeMs < playback.durationMs * 0.5) return;

      const remainingMs = Math.max(0, playback.durationMs - playback.currentTimeMs);
      if (!focusState.mainFlightCompleted) {
        focusState.retreatPending = true;
        return;
      }
      focusState.startRetreat(remainingMs);
    }, 140);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedEventId;
    const viewer = viewerRef.current;
    if (!viewer) return;
    const previousFocusState = activeFocusCameraRef.current;
    activeFocusCameraRef.current = null;
    const haloMap = new Map(
      buildEventHaloLayers(Array.from(eventMapRef.current.values()), selectedEventId, Date.now()).map(
        (halo) => [halo.eventId, halo] as const
      )
    );
    eventHaloMapRef.current = haloMap;

    if (selectionWaveTimerRef.current !== null) {
      window.clearInterval(selectionWaveTimerRef.current);
      selectionWaveTimerRef.current = null;
    }

    for (const entity of viewer.entities.values) {
      if (typeof entity.id !== "string" || entity.id.startsWith(WAVE_PREFIX)) continue;
      const event = eventMapRef.current.get(entity.id);
      if (event) {
        styleEntity(entity, event, entity.id === selectedEventId, haloMap.get(entity.id) ?? null);
      }
    }

    if (!selectedEventId) return;
    const event = eventMapRef.current.get(selectedEventId);
    if (!event) return;

    stopSpinRef.current?.();
    viewer.camera.cancelFlight();
    const destination = Cartographic.fromDegrees(event.longitude, event.latitude);
    const previousFocusCartographic =
      previousFocusState && previousFocusState.eventId !== event.eventId
        ? Cartographic.fromCartesian(previousFocusState.focusSphere.center)
        : viewer.camera.positionCartographic;
    const surfaceDistance = new EllipsoidGeodesic(previousFocusCartographic, destination).surfaceDistance;

    const flightSequence = ++cameraFlightSequenceRef.current;
    for (const entity of viewer.entities.values) {
      if (typeof entity.id !== "string" || !eventMapRef.current.has(entity.id)) continue;
      if (entity.billboard) entity.billboard.show = new ConstantProperty(false);
    }
    const restoreSelectedHalo = () => {
      if (cameraFlightSequenceRef.current !== flightSequence || viewer.isDestroyed()) return;
      for (const entity of viewer.entities.values) {
        if (typeof entity.id !== "string") continue;
        const candidate = eventMapRef.current.get(entity.id);
        if (candidate) {
          styleEntity(
            entity,
            candidate,
            entity.id === selectedIdRef.current,
            eventHaloMapRef.current.get(entity.id) ?? null
          );
        }
      }
    };

    // DirecciÃ³n de cÃ¡mara cinematogrÃ¡fica: el encuadre lo decide la magnitud /
    // profundidad / intensidad y si el evento es marino (no sobre-acercar).
    const shot = computeCameraShot(event);
    const transitionPlan = computeInterEventTransitionPlan(
      surfaceDistance,
      shot,
      previousFocusState && previousFocusState.eventId !== event.eventId ? previousFocusState.shot : null
    );
    const focusTarget = Cartesian3.fromDegrees(event.longitude, event.latitude, 0);
    const focusSphere = new BoundingSphere(focusTarget, 1);
    const approachArc = transitionPlan.overviewRange;
    const directOverviewPitchDeg = -88;
    const retreatRange = Math.max(computeNarrationRetreatRange(shot), transitionPlan.retreatRange);
    const retreatState: ActiveFocusCameraState = {
      eventId: event.eventId,
      flightSequence,
      focusSphere,
      shot,
      mainFlightCompleted: false,
      retreatPending: false,
      retreatTriggered: false,
      startRetreat: (remainingMs) => {
        if (retreatState.retreatTriggered) return;
        retreatState.retreatTriggered = true;
        if (cameraFlightSequenceRef.current !== flightSequence || viewer.isDestroyed()) return;
        void viewer.camera.flyToBoundingSphere(focusSphere, {
          offset: new HeadingPitchRange(
            CesiumMath.toRadians(shot.headingDeg),
            CesiumMath.toRadians(transitionPlan.overviewPitchDeg),
            retreatRange
          ),
          duration: clampNarrationRetreatDurationSeconds(remainingMs),
          easingFunction: EasingFunction.CUBIC_OUT
        });
      }
    };
    activeFocusCameraRef.current = retreatState;

    // Orbita lenta tipo turntable mientras la voz narra: mismo range y pitch, solo
    // gira el rumbo => movimiento limpio y continuo, sin dolly brusco.
    const startGentleOrbit = () => {
      if (cameraFlightSequenceRef.current !== flightSequence || viewer.isDestroyed()) return;
      if (retreatState.retreatTriggered) return;
      if (shot.orbitDeg === 0) return;
      void viewer.camera.flyToBoundingSphere(focusSphere, {
        offset: new HeadingPitchRange(
          CesiumMath.toRadians(shot.headingDeg + shot.orbitDeg),
          CesiumMath.toRadians(shot.pitchDeg),
          shot.range
        ),
        duration: shot.dwellMs / 1000,
        easingFunction: EasingFunction.QUADRATIC_IN_OUT
      });
    };

    const finalizeFocusFlight = (fromDirectOverview = false) => {
      if (cameraFlightSequenceRef.current !== flightSequence || viewer.isDestroyed()) return;
      const focusFlight = {
        offset: new HeadingPitchRange(
          CesiumMath.toRadians(shot.headingDeg),
          CesiumMath.toRadians(shot.pitchDeg),
          shot.range
        ),
        duration: fromDirectOverview
          ? shot.duration
          : Math.max(shot.duration, transitionPlan.approachDuration),
        easingFunction: EasingFunction.CUBIC_IN_OUT,
        complete: () => {
          retreatState.mainFlightCompleted = true;
          restoreSelectedHalo();
          if (retreatState.retreatPending) {
            const playback = getActiveEventNarrationPlayback();
            if (playback && playback.engine === "chatterbox" && playback.eventId === retreatState.eventId) {
              retreatState.startRetreat(
                playback.durationMs !== null
                  ? Math.max(0, playback.durationMs - playback.currentTimeMs)
                  : null
              );
              return;
            }
          }
          startGentleOrbit();
        },
        cancel: restoreSelectedHalo
      };

      if (fromDirectOverview) {
        void viewer.camera.flyToBoundingSphere(focusSphere, focusFlight);
        return;
      }

      void viewer.camera.flyToBoundingSphere(focusSphere, {
        ...focusFlight,
        maximumHeight: approachArc
      });
    };

    const flyDirectlyAboveNextFocus = () => {
      if (cameraFlightSequenceRef.current !== flightSequence || viewer.isDestroyed()) return;
      void viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(event.longitude, event.latitude, transitionPlan.overviewRange),
        orientation: {
          heading: CesiumMath.toRadians(shot.headingDeg),
          pitch: CesiumMath.toRadians(directOverviewPitchDeg),
          roll: 0
        },
        duration: Math.max(1.6, Math.min(2.7, transitionPlan.approachDuration * 0.55)),
        maximumHeight: transitionPlan.overviewRange,
        easingFunction: EasingFunction.CUBIC_IN_OUT,
        complete: () => finalizeFocusFlight(true),
        cancel: restoreSelectedHalo
      });
    };

    if (previousFocusState && previousFocusState.eventId !== event.eventId) {
      void viewer.camera.flyTo({
        destination: Cartesian3.fromRadians(
          previousFocusCartographic.longitude,
          previousFocusCartographic.latitude,
          transitionPlan.overviewRange
        ),
        orientation: {
          heading: CesiumMath.toRadians(previousFocusState.shot.headingDeg),
          pitch: CesiumMath.toRadians(directOverviewPitchDeg),
          roll: 0
        },
        duration: transitionPlan.exitDuration,
        easingFunction: EasingFunction.CUBIC_OUT,
        complete: flyDirectlyAboveNextFocus,
        cancel: restoreSelectedHalo
      });
    } else {
      finalizeFocusFlight();
    }

    spawnWavefront(viewer, event, soundEnabled);
    selectionWaveTimerRef.current = window.setInterval(() => {
      if (viewer.isDestroyed()) return;
      const activeId = selectedIdRef.current;
      if (!activeId) return;
      const activeEvent = eventMapRef.current.get(activeId);
      if (!activeEvent) return;
      spawnWavefront(viewer, activeEvent, soundEnabled, { playSound: false });
    }, SELECTION_WAVE_INTERVAL_MS);
  }, [selectedEventId, soundEnabled]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !selectedEventId) return;

    const selectedEvent = eventMapRef.current.get(selectedEventId);
    if (!selectedEvent) return;

    const controller = new AbortController();
    const activeDataSources: GeoJsonDataSource[] = [];
    let isCancelled = false;

    const clearPagerCities = () => {
      pagerCityMapRef.current = new Map();
      pagerPriorityLabelsRef.current = [];
      mapLabelRefreshRef.current?.();
    };
    clearPagerCities();

    async function fetchAndRenderOfficialImpact(activeEvent: SeismicEvent) {
      if (activeEvent.source !== "USGS") return;
      const summary = await fetchOfficialImpactSummary(activeEvent.eventId, controller.signal);
      if (isCancelled || !summary || !viewerRef.current || viewerRef.current.isDestroyed()) return;

      if (summary.pager) {
        const cityMap = new Map<string, PagerCityIndicator>();
        const labels = summary.pager.cities.map((city, index) => {
          const id = `${PAGER_CITY_PREFIX}${activeEvent.eventId}:${index}`;
          cityMap.set(id, { city, pager: summary.pager! });
          return {
            id,
            text: `${city.name} · MMI ${city.mmi.toLocaleString("es-PE", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1
            })}`,
            latitude: city.latitude,
            longitude: city.longitude,
            color: intensityCssColor(city.mmi),
            font: '700 12px "Bahnschrift Condensed", "Arial Narrow", sans-serif',
            fontSize: 12,
            outlineWidth: 4
          } satisfies PriorityMapLabel;
        });
        pagerCityMapRef.current = cityMap;
        pagerPriorityLabelsRef.current = labels;
        mapLabelRefreshRef.current?.();
      }

      const layers: Array<{
        layer: OfficialGeoJsonLayer;
        sourceUrl: string;
        responseCount: number | null;
      }> = [];
      if (summary.shakeMap) {
        for (const layer of Object.values(summary.shakeMap.layers)) {
          if (layer) layers.push({ layer, sourceUrl: summary.shakeMap.sourceUrl, responseCount: null });
        }
      }
      if (summary.dyfi) {
        layers.push({
          layer: summary.dyfi.layer,
          sourceUrl: summary.dyfi.sourceUrl,
          responseCount: summary.dyfi.responseCount
        });
      }

      await Promise.all(
        layers.map(async ({ layer, sourceUrl, responseCount }) => {
          try {
            const dataSource = await addOfficialImpactDataSource(
              viewerRef.current!,
              layer,
              sourceUrl,
              responseCount
            );
            if (isCancelled || !viewerRef.current || viewerRef.current.isDestroyed()) {
              if (viewerRef.current && !viewerRef.current.isDestroyed()) {
                viewerRef.current.dataSources.remove(dataSource, true);
              }
              return;
            }
            activeDataSources.push(dataSource);
          } catch (error) {
            console.warn(`No se pudo cargar la capa oficial ${layer.kind}.`, error);
          }
        })
      );
    }

    void fetchAndRenderOfficialImpact(selectedEvent).catch((error) => {
      if (!isCancelled && !(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("No se pudieron cargar los productos oficiales del evento.", error);
      }
    });

    return () => {
      isCancelled = true;
      controller.abort();
      clearPagerCities();
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        for (const dataSource of activeDataSources) {
          viewerRef.current.dataSources.remove(dataSource, true);
        }
      }
    };
  }, [selectedEventId]);

  const tourEvent =
    (selectedEventId ? events.find((event) => event.eventId === selectedEventId) : undefined) ??
    events[0] ??
    null;
  const selectedStation = selectedStationId ? (stationMapRef.current.get(selectedStationId) ?? null) : null;
  const selectedSeaLevelStation = selectedSeaLevelStationId
    ? (seaLevelStationMapRef.current.get(selectedSeaLevelStationId) ?? null)
    : null;

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-canvas cesium-canvas" />

      {hover?.kind === "event" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{normalizedPlace(hover.event, resolveCountryCode(hover.event))}</strong>
          <span>
            {formatMagnitude(hover.event.magnitude)} | Prof. {formatDepth(hover.event.depthKm)}
          </span>
          <span>{formatUtcDateTime(hover.event.eventTimeUtc)} UTC</span>
          <span className="tt-source">Fuente: {hover.event.source}</span>
        </div>
      ) : null}

      {hover?.kind === "disaster" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hover.context.title}</strong>
          <span>
            GDACS {hover.context.alertLevel ?? "N/D"} | score {hover.context.alertScore ?? "N/D"}
          </span>
          <span>{formatUtcDateTime(hover.context.eventTimeUtc)} UTC</span>
        </div>
      ) : null}

      {hover?.kind === "station" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>
            {hover.station.networkCode}.{hover.station.stationCode}
          </strong>
          <span>{hover.station.siteName ?? "Estacion sin nombre publicado"}</span>
          <span className="tt-source">
            {hover.station.status.toUpperCase()} | {hover.station.source}
          </span>
        </div>
      ) : null}

      {hover?.kind === "sea-level" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hover.station.name}</strong>
          <span>{hover.station.countryName ?? "Pais no publicado"}</span>
          <span>
            {hover.station.status.toUpperCase()} | lectura: {formatSeaLevelValue(hover.station)}
          </span>
          {hover.priorityDistanceKm !== null ? (
            <>
              <span>
                Estacion costera priorizada ·{" "}
                {hover.priorityDistanceKm.toLocaleString("es-PE", {
                  maximumFractionDigits: 0
                })}{" "}
                km del epicentro
              </span>
              <span>El indicador de la fuente no equivale a alerta ni confirma una ola.</span>
            </>
          ) : null}
          <span className="tt-source">UNESCO/IOC | sensor {hover.station.sensor ?? "N/D"}</span>
        </div>
      ) : null}

      {hover?.kind === "origin" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>Epicentro experimental</strong>
          <span>
            {formatMagnitude(hover.origin.magnitude)} | {hover.origin.status.toUpperCase()} |{" "}
            {hover.origin.quality.toUpperCase()}
          </span>
          <span>
            {formatUtcDateTime(hover.origin.originTimeUtc)} UTC | Prof. {formatDepth(hover.origin.depthKm)}
          </span>
          <span className="tt-source">
            Motor: {hover.origin.engine} | estaciones: {hover.origin.stationCount}
          </span>
        </div>
      ) : null}

      {hover?.kind === "coastal-zone" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>Franja costera priorizada</strong>
          <span>{hover.layer.label}</span>
          <span>
            {formatMagnitude(hover.layer.magnitude)} |{" "}
            {hover.layer.tsunami ? "Bandera de tsunami en fuente" : "Evento costero reciente"}
          </span>
          <span className="tt-source">Enfoque costero editorial</span>
        </div>
      ) : null}

      {hover?.kind === "pager-city" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hover.indicator.city.name}</strong>
          <span>
            Intensidad {hover.indicator.city.intensityRoman} · MMI{" "}
            {hover.indicator.city.mmi.toLocaleString("es-PE", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1
            })}
          </span>
          <span>
            Poblacion expuesta: {new Intl.NumberFormat("es-PE").format(hover.indicator.city.population)}
          </span>
          <span>Alerta PAGER: {hover.indicator.pager.alertLevel?.toUpperCase() ?? "N/D"}</span>
          <span>Actualizado: {formatUtcDateTime(hover.indicator.pager.updatedAtUtc)} UTC</span>
          <span className="tt-source">USGS PAGER oficial · no es un reporte local de danos</span>
        </div>
      ) : null}

      {hover?.kind === "sequence" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>
            {hover.indicator.member.role === "principal" ? "Evento principal" : "Actividad posterior"}
          </strong>
          <span>
            {formatMagnitude(hover.indicator.member.event.magnitude)} ·{" "}
            {formatUtcDateTime(hover.indicator.member.event.eventTimeUtc)} UTC
          </span>
          {hover.indicator.member.role === "posterior" ? (
            <span>
              +
              {hover.indicator.member.hoursAfterPrincipal.toLocaleString("es-PE", {
                maximumFractionDigits: 1
              })}{" "}
              h ·{" "}
              {hover.indicator.member.distanceKm.toLocaleString("es-PE", {
                maximumFractionDigits: 0
              })}{" "}
              km del principal
            </span>
          ) : (
            <span>
              Actividad posterior: 6 h {hover.indicator.summary.count6h} · 24 h{" "}
              {hover.indicator.summary.count24h}
            </span>
          )}
          <span className="tt-source">Agrupacion temporal y espacial del mapa; no establece causalidad</span>
        </div>
      ) : null}

      {hover?.kind === "official-area" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>
            {hover.indicator.metric === "mmi"
              ? "Intensidad ShakeMap oficial"
              : hover.indicator.metric === "pga"
                ? "Aceleracion maxima del suelo"
                : hover.indicator.metric === "pgv"
                  ? "Velocidad maxima del suelo"
                  : "Concentracion de reportes sentidos DYFI"}
          </strong>
          <span>
            {hover.indicator.metric === "mmi" ? `${intensityAreaBandLabel(hover.indicator.value)} · ` : ""}
            {hover.indicator.unit}{" "}
            {hover.indicator.value.toLocaleString("es-PE", {
              maximumFractionDigits: 2
            })}
          </span>
          {hover.indicator.metric === "dyfi" ? (
            <>
              <span>Respuestas agregadas: {hover.indicator.responseCount ?? "N/D"}</span>
              <span>
                Agregacion: {hover.indicator.aggregationKm ?? "N/D"} km · desviacion{" "}
                {hover.indicator.standardDeviation ?? "N/D"}
              </span>
            </>
          ) : null}
          <span>Actualizado: {formatUtcDateTime(hover.indicator.updatedAtUtc)} UTC</span>
          <span className="tt-source">USGS oficial · valores sin interpolacion local</span>
        </div>
      ) : null}

      {hover?.kind === "volcano" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hover.name}</strong>
          <span>{hover.type}</span>
          <span className="tt-source">{hover.country}</span>
        </div>
      ) : null}

      {tourEvent && !selectedStation && !selectedSeaLevelStation ? (
        <div className="tour-card">
          <button
            type="button"
            className={tourPaused ? "tour-toggle paused" : "tour-toggle"}
            onClick={onToggleTour}
            title={tourPaused ? "Reanudar recorrido" : "Pausar recorrido"}
            aria-label={tourPaused ? "Reanudar recorrido" : "Pausar recorrido"}
          >
            {tourPaused ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M3 2.2 10 6 3 9.8Z" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <rect x="2.2" y="1.5" width="2.8" height="9" rx="1.1" />
                <rect x="7" y="1.5" width="2.8" height="9" rx="1.1" />
              </svg>
            )}
          </button>
          <MosaicSwap swapKey={tourEvent.eventId} className="tour-card-body">
            <div className="tour-card-top">
              <CountryFlag event={tourEvent} className="tour-flag" />
              <strong className="tour-title">
                <span style={{ color: magnitudeCssColor(tourEvent.magnitude) }}>
                  {formatMagnitude(tourEvent.magnitude)}
                </span>{" "}
                - {normalizedPlace(tourEvent, resolveCountryCode(tourEvent))}
              </strong>
            </div>
            <div
              className="tour-card-meta"
              style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px" }}
            >
              {formatUtcDateTime(tourEvent.eventTimeUtc)} UTC | Prof: {formatDepth(tourEvent.depthKm)} |
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <i
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "2px",
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: intensityCssColor(estimatedIntensity(tourEvent))
                  }}
                />
                {normalizedIntensity(tourEvent)}
              </span>
            </div>
            <span className="tour-card-source">Datos: {tourEvent.source}</span>
          </MosaicSwap>
        </div>
      ) : null}

      {selectedStation ? (
        <section className="station-detail" aria-label="Detalle de estacion experimental">
          <button
            type="button"
            className="station-detail-close"
            onClick={() => setSelectedStationId(null)}
            aria-label="Cerrar detalle de estacion"
            title="Cerrar"
          >
            x
          </button>
          <span className="station-detail-kicker">ESTACION GEOFON / POSICION FIJA DE CATALOGO</span>
          <strong>
            {selectedStation.networkCode}.{selectedStation.stationCode}
          </strong>
          <span>{selectedStation.siteName ?? "Sin nombre publicado"}</span>
          <dl>
            <div>
              <dt>Estado</dt>
              <dd style={{ color: STATION_COLORS[selectedStation.status] }}>
                {selectedStation.status.toUpperCase()}
              </dd>
            </div>
            <div>
              <dt>Fase</dt>
              <dd>{selectedStation.phase ?? "N/D"}</dd>
            </div>
            <div>
              <dt>Latencia</dt>
              <dd>{selectedStation.latencyMs === null ? "N/D" : `${selectedStation.latencyMs} ms`}</dd>
            </div>
            <div>
              <dt>Motor</dt>
              <dd>{selectedStation.engine ?? "Sin telemetria"}</dd>
            </div>
          </dl>
          <a href={selectedStation.sourceUrl} target="_blank" rel="noreferrer">
            Metadatos GEOFON
          </a>
        </section>
      ) : null}

      {selectedSeaLevelStation ? (
        <SeaLevelStationDetail
          station={selectedSeaLevelStation}
          onClose={() => setSelectedSeaLevelStationId(null)}
        />
      ) : null}

      <div className="map-legend legend-map-layers">
        <span className="legend-title">Limites de placa</span>
        <span className="legend-row">
          <i style={{ background: PLATE_COLORS.subduction }} />
          Subduccion
        </span>
        <span className="legend-row">
          <i style={{ background: PLATE_COLORS.convergent }} />
          Convergente
        </span>
        <span className="legend-row">
          <i style={{ background: PLATE_COLORS.divergent }} />
          Divergente
        </span>
        <span className="legend-row">
          <i style={{ background: PLATE_COLORS.transform }} />
          Transformante
        </span>
        <span className="legend-row">
          <i style={{ background: "#dc2626", opacity: 0.6 }} />
          Fallas activas
        </span>
        <span className="legend-row">
          <i
            className="legend-point"
            style={{
              borderBottom: "10px solid #f97316",
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              background: "transparent",
              borderRadius: 0,
              height: 0,
              width: 0
            }}
          />
          Volcanes (USGS)
        </span>
        <span className="legend-row">
          <i className="legend-point" style={{ background: "#ff9f1c" }} />
          Contexto GDACS
        </span>
        <span className="legend-row">
          <i style={{ background: "linear-gradient(to right, #7aff93, #ff0000)", opacity: 0.8 }} />
          ShakeMap MMI / PGA / PGV
        </span>
        <span className="legend-row">
          <i style={{ background: "linear-gradient(to right, #a5f3fc, #facc15)", opacity: 0.72 }} />
          DYFI reportes sentidos
        </span>
        <span className="legend-section-separator" />
        <span className="legend-title">Capas dinamicas 2D</span>
        <span className="legend-row">
          <i
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.85)",
              background: "rgba(125,211,252,0.8)"
            }}
          />
          Evento principal / actividad posterior
        </span>
        <span className="legend-row">
          <i
            style={{
              width: "16px",
              height: "4px",
              borderRadius: "999px",
              background: "rgba(125,211,252,0.82)"
            }}
          />
          Franja costera
        </span>
      </div>

      <SeismicPresenceLegend summary={seismicPresence} />
      <TopMagnitudeTable historical={topMagnitude} liveEvents={events} />

      <div
        className="map-legend legend-intensity"
        style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "5px 24px" }}
      >
        <div style={{ display: "grid", gap: "5px" }}>
          <span className="legend-title">Intensidad MMI (Color)</span>
          {INTENSITY_BANDS.map((band) => (
            <span className="legend-row" key={band.label}>
              <i className="legend-swatch" style={{ background: band.color }} />
              {band.label}
            </span>
          ))}
        </div>
        <div style={{ display: "grid", gap: "5px", alignContent: "start" }}>
          <span className="legend-title">Magnitud (Tamano)</span>
          {MAGNITUDE_BANDS.map((band) => {
            const mag = band.max === Infinity ? 7.5 : band.max - 0.5;
            const size = Math.min(16, magnitudeSize(mag));
            return (
              <span className="legend-row" key={band.label}>
                <div
                  style={{
                    width: 16,
                    height: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <i
                    className="legend-point"
                    style={{ background: "#94a3b8", width: size, height: size, margin: 0, border: "none" }}
                  />
                </div>
                {band.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
