import { useEffect, useRef, useState } from "react";

import {
  type DisasterContext,
  type ExperimentalOrigin,
  type SeismicEvent,
  type SeismicPresenceSummary,
  type SeismicStation
} from "@sismica/shared";
import {
  BillboardGraphics,
  CallbackProperty,
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  EasingFunction,
  EllipsoidGeodesic,
  Entity,
  GeoJsonDataSource,
  HorizontalOrigin,
  Ion,
  JulianDate,
  Math as CesiumMath,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
  defined
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { resolveCountryCode } from "../lib/countryGeocoder";
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
import { playSeismicWaveSound } from "../lib/seismicAudio";
import { CountryFlag } from "./CountryFlag";
import { MosaicSwap } from "./MosaicSwap";
import { TopMagnitudeTable } from "./TopMagnitudeTable";

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";

type MapPanelProps = {
  disasters: DisasterContext[];
  events: SeismicEvent[];
  stations: SeismicStation[];
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
const WAVE_MAX_RADIUS_M = 1_500_000;
const FRESH_WINDOW_MS = 10 * 60 * 1000;
const SELECTION_WAVE_INTERVAL_MS = 3_500;

const DISASTER_PREFIX = "context:";
const STATION_PREFIX = "station:";
const EXPERIMENTAL_ORIGIN_PREFIX = "origin:";
const WAVE_PREFIX = "wave:";

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

function magnitudeSize(magnitude: number | null): number {
  if (magnitude === null) return 8;
  return Math.max(8, Math.min(34, magnitude * 5));
}

function styleEntity(entity: Entity, event: SeismicEvent, selected: boolean): void {
  if (!entity.point) return;

  const mmi = estimatedIntensity(event);
  const base = Color.fromCssColorString(intensityCssColor(mmi));
  const baseSize = magnitudeSize(event.magnitude);

  entity.point.color = new ConstantProperty(base.withAlpha(selected ? 1 : 0.92));
  entity.point.outlineColor = new ConstantProperty(
    selected ? Color.WHITE.withAlpha(0.96) : Color.fromCssColorString("#0b1220").withAlpha(0.9)
  );
  entity.point.outlineWidth = new ConstantProperty(selected ? 3 : 1.5);

  if (selected) {
    entity.point.pixelSize = new CallbackProperty(
      () => baseSize + 2.4 + Math.sin(Date.now() / 180) * 1.6,
      false
    );
  } else {
    entity.point.pixelSize = new ConstantProperty(baseSize);
  }
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

function spawnSeismicRing(
  viewer: Viewer,
  longitude: number,
  latitude: number,
  color: Color,
  velocityMps: number,
  depthM: number,
  outlineWidth: number
): void {
  const start = performance.now();
  let radius = 0;

  const surfaceRadius = () => {
    const realSeconds = ((performance.now() - start) / 1000) * WAVE_TIME_ACCEL;
    const sphere = velocityMps * realSeconds;
    if (sphere <= depthM) return 0;
    return Math.min(WAVE_MAX_RADIUS_M, Math.sqrt(sphere * sphere - depthM * depthM));
  };

  const semiMajorAxis = () => {
    radius = surfaceRadius();
    return Math.max(1, radius);
  };
  const semiMinorAxis = () => Math.max(1, radius - 0.001);
  const fade = () => (radius <= 0 ? 0 : 1 - radius / WAVE_MAX_RADIUS_M);

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

  const lifeMs =
    (Math.sqrt(WAVE_MAX_RADIUS_M ** 2 + depthM ** 2) / velocityMps / WAVE_TIME_ACCEL) * 1000 + 250;
  window.setTimeout(() => {
    if (!viewer.isDestroyed()) viewer.entities.remove(ring);
  }, lifeMs);
}

function spawnWavefront(viewer: Viewer, event: SeismicEvent, soundEnabled: boolean): void {
  const depthM = Math.max(0, (event.depthKm ?? 0) * 1000);
  const magColor = Color.fromCssColorString(magnitudeCssColor(event.magnitude));

  spawnSeismicRing(viewer, event.longitude, event.latitude, magColor, VP_MPS, depthM, 2);
  spawnSeismicRing(viewer, event.longitude, event.latitude, magColor, VS_MPS, depthM, 3);
  playSeismicWaveSound(event, soundEnabled);
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

  viewer.imageryLayers.addImageryProvider(
    new UrlTemplateImageryProvider({
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
      subdomains: "abcd",
      maximumLevel: 20,
      credit: "(c) OpenStreetMap contributors (c) CARTO"
    })
  );
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
  const experimentalOriginMapRef = useRef<Map<string, ExperimentalOrigin>>(new Map());
  const disasterMapRef = useRef<Map<string, DisasterContext>>(new Map());
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const selectedIdRef = useRef<string | null>(selectedEventId);
  const stopSpinRef = useRef<(() => void) | null>(null);
  const selectionWaveTimerRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [hover, setHover] = useState<
    | { kind: "event"; event: SeismicEvent; x: number; y: number }
    | { kind: "disaster"; context: DisasterContext; x: number; y: number }
    | { kind: "station"; station: SeismicStation; x: number; y: number }
    | { kind: "origin"; origin: ExperimentalOrigin; x: number; y: number }
    | { kind: "volcano"; name: string; country: string; type: string; x: number; y: number }
    | null
  >(null);
  const [stationsVisible, setStationsVisible] = useState(true);
  const [experimentalOriginsVisible, setExperimentalOriginsVisible] = useState(true);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

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
      selectionIndicator: false
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
      const picked = viewer.scene.pick(movement.position);
      if (!defined(picked) || !(picked.id instanceof Entity) || typeof picked.id.id !== "string") return;
      if (eventMapRef.current.has(picked.id.id)) {
        onSelectRef.current(picked.id.id);
      } else if (stationMapRef.current.has(picked.id.id)) {
        setSelectedStationId(picked.id.id);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement: ScreenSpaceEventHandler.MotionEvent) => {
      const picked = viewer.scene.pick(movement.endPosition);
      const entity = defined(picked) && picked.id instanceof Entity ? picked.id : undefined;
      const id = entity?.id;
      const event = typeof id === "string" ? eventMapRef.current.get(id) : undefined;
      const context = typeof id === "string" ? disasterMapRef.current.get(id) : undefined;
      const station = typeof id === "string" ? stationMapRef.current.get(id) : undefined;
      const origin = typeof id === "string" ? experimentalOriginMapRef.current.get(id) : undefined;

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
      } else if (origin) {
        setHover({
          kind: "origin",
          origin,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "default";
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

    void setupBasemap(viewer);
    void loadPlateBoundaries(viewer);
    void loadActiveFaults(viewer);
    void loadVolcanoes(viewer);

    return () => {
      if (selectionWaveTimerRef.current !== null) {
        window.clearInterval(selectionWaveTimerRef.current);
        selectionWaveTimerRef.current = null;
      }
      stopSpin();
      stopSpinRef.current = null;
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
    eventMapRef.current = nextMap;
    const firstLoad = !initializedRef.current;

    collection.suspendEvents();

    for (const entity of [...collection.values]) {
      if (
        typeof entity.id === "string" &&
        (entity.id.startsWith(WAVE_PREFIX) ||
          entity.id.startsWith(DISASTER_PREFIX) ||
          entity.id.startsWith(STATION_PREFIX) ||
          entity.id.startsWith(EXPERIMENTAL_ORIGIN_PREFIX))
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

      styleEntity(entity, event, selected);

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
    const viewer = viewerRef.current;
    if (!viewer) return;

    const nextMap = new Map(stations.map((station) => [`${STATION_PREFIX}${station.stationId}`, station]));
    stationMapRef.current = nextMap;

    for (const entity of [...viewer.entities.values]) {
      if (typeof entity.id === "string" && entity.id.startsWith(STATION_PREFIX) && !nextMap.has(entity.id)) {
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
        const selected = id === selectedStationId;
        entity.billboard.image = new ConstantProperty(stationSymbol(station, selected));
        entity.billboard.scale = new ConstantProperty(selected ? 0.95 : 0.68);
        entity.billboard.horizontalOrigin = new ConstantProperty(HorizontalOrigin.CENTER);
        entity.billboard.verticalOrigin = new ConstantProperty(VerticalOrigin.CENTER);
        entity.billboard.show = new ConstantProperty(stationsVisible);
      }
    }
  }, [stations, stationsVisible, selectedStationId]);

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
    selectedIdRef.current = selectedEventId;
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (selectionWaveTimerRef.current !== null) {
      window.clearInterval(selectionWaveTimerRef.current);
      selectionWaveTimerRef.current = null;
    }

    for (const entity of viewer.entities.values) {
      if (typeof entity.id !== "string" || entity.id.startsWith(WAVE_PREFIX)) continue;
      const event = eventMapRef.current.get(entity.id);
      if (event) {
        styleEntity(entity, event, entity.id === selectedEventId);
      }
    }

    if (!selectedEventId) return;
    const event = eventMapRef.current.get(selectedEventId);
    if (!event) return;

    stopSpinRef.current?.();
    const destination = Cartographic.fromDegrees(event.longitude, event.latitude);
    const surfaceDistance = new EllipsoidGeodesic(viewer.camera.positionCartographic, destination)
      .surfaceDistance;
    const maximumHeight = CesiumMath.clamp(surfaceDistance * 0.5, 500_000, 9_000_000);

    void viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(event.longitude, event.latitude, 450_000),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
      duration: 3.2,
      maximumHeight,
      easingFunction: EasingFunction.QUADRATIC_IN_OUT
    });

    spawnWavefront(viewer, event, soundEnabled);
    selectionWaveTimerRef.current = window.setInterval(() => {
      if (viewer.isDestroyed()) return;
      const activeId = selectedIdRef.current;
      if (!activeId) return;
      const activeEvent = eventMapRef.current.get(activeId);
      if (!activeEvent) return;
      spawnWavefront(viewer, activeEvent, soundEnabled);
    }, SELECTION_WAVE_INTERVAL_MS);
  }, [selectedEventId, soundEnabled]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !selectedEventId) return;

    const event = eventMapRef.current.get(selectedEventId);
    if (!event || event.source !== "USGS" || !event.detailUrl) return;
    const detailUrl = event.detailUrl;

    let activeDataSource: GeoJsonDataSource | null = null;
    let isCancelled = false;

    async function fetchAndRenderShakeMap() {
      try {
        const res = await fetch(detailUrl);
        const data = (await res.json()) as {
          properties?: {
            products?: {
              shakemap?: Array<{
                contents?: Record<string, { url?: string }>;
              }>;
            };
          };
        };
        if (isCancelled) return;

        const shakemapProduct = data.properties?.products?.shakemap?.[0];
        if (!shakemapProduct) return;
        const contUrl = shakemapProduct.contents?.["download/cont_mi.json"]?.url;
        if (!contUrl) return;

        const dataSource = await GeoJsonDataSource.load(contUrl, {
          clampToGround: true,
          strokeWidth: 2
        });

        if (isCancelled || !viewerRef.current || viewerRef.current.isDestroyed()) return;

        for (const entity of dataSource.entities.values) {
          const valueProp = entity.properties?.value;
          const value = valueProp ? parseFloat(valueProp.getValue(JulianDate.now())) : null;
          if (value === null) continue;

          const colorCss = intensityCssColor(value);
          const cesiumColor = Color.fromCssColorString(colorCss).withAlpha(0.4);
          if (entity.polygon) {
            entity.polygon.material = new ColorMaterialProperty(cesiumColor);
            entity.polygon.outline = new ConstantProperty(false);
          }
          if (entity.polyline) {
            entity.polyline.material = new ColorMaterialProperty(cesiumColor);
            entity.polyline.width = new ConstantProperty(2);
          }
        }

        await viewerRef.current.dataSources.add(dataSource);
        activeDataSource = dataSource;
      } catch (error) {
        console.warn("Failed to load shakemap for event", error);
      }
    }

    void fetchAndRenderShakeMap();

    return () => {
      isCancelled = true;
      if (activeDataSource && viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.dataSources.remove(activeDataSource);
      }
    };
  }, [selectedEventId]);

  const tourEvent =
    (selectedEventId ? events.find((event) => event.eventId === selectedEventId) : undefined) ??
    events[0] ??
    null;
  const selectedStation = selectedStationId ? (stationMapRef.current.get(selectedStationId) ?? null) : null;

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

      {hover?.kind === "volcano" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hover.name}</strong>
          <span>{hover.type}</span>
          <span className="tt-source">{hover.country}</span>
        </div>
      ) : null}

      {tourEvent && !selectedStation ? (
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
          <span className="station-detail-kicker">ESTACION EXPERIMENTAL</span>
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

      <div className="map-legend">
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
          ShakeMap (USGS)
        </span>
      </div>

      <SeismicPresenceLegend summary={seismicPresence} />
      <TopMagnitudeTable historical={topMagnitude} liveEvents={events} />

      <div
        className="map-legend legend-intensity"
        style={{ width: "auto", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "5px 24px" }}
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
