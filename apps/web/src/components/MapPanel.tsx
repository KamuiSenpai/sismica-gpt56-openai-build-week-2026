import { useEffect, useRef, useState } from "react";

import { type DisasterContext, type SeismicEvent } from "@sismica/shared";
import {
  CallbackProperty,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  Entity,
  GeoJsonDataSource,
  Ion,
  JulianDate,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
  defined
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { formatDepth, formatMagnitude, formatUtcDateTime, getEventPlace } from "../lib/presentation";

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";

type MapPanelProps = {
  disasters: DisasterContext[];
  events: SeismicEvent[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
};

const WAVE_P_COLOR = Color.fromCssColorString("#2563eb");
const WAVE_S_COLOR = Color.fromCssColorString("#facc15");
const FRESH_WINDOW_MS = 10 * 60 * 1000;
const SELECTION_WAVE_INTERVAL_MS = 2_200;
const DISASTER_PREFIX = "context:";

const PLATE_COLORS: Record<string, string> = {
  subduction: "#d946ef",
  convergent: "#ef4444",
  divergent: "#22c55e",
  transform: "#f59e0b"
};

// Color por MAGNITUD (la cifra "Richter"/Mw del sismo). Todos los sismos tienen
// magnitud, asi que todos los puntos quedan coloreados. Clases descriptivas USGS.
const MAG_BANDS: { max: number; color: string; label: string }[] = [
  { max: 2, color: "#22c55e", label: "Micro (<2)" },
  { max: 4, color: "#a3e635", label: "Menor (2–3.9)" },
  { max: 5, color: "#facc15", label: "Ligero (4–4.9)" },
  { max: 6, color: "#fb923c", label: "Moderado (5–5.9)" },
  { max: 7, color: "#ef4444", label: "Fuerte (6–6.9)" },
  { max: Number.POSITIVE_INFINITY, color: "#b91c1c", label: "Mayor (≥7)" }
];
const NO_MAGNITUDE_COLOR = "#64748b";

function magnitudeBand(magnitude: number): (typeof MAG_BANDS)[number] {
  return MAG_BANDS.find((band) => magnitude < band.max) ?? MAG_BANDS[MAG_BANDS.length - 1];
}

function magnitudeColor(magnitude: number | null): Color {
  return Color.fromCssColorString(magnitude === null ? NO_MAGNITUDE_COLOR : magnitudeBand(magnitude).color);
}

function magnitudeSize(magnitude: number | null): number {
  if (magnitude === null) return 8;
  return Math.max(8, Math.min(34, magnitude * 5));
}

function styleEntity(entity: Entity, event: SeismicEvent, selected: boolean): void {
  if (!entity.point) return;

  const base = magnitudeColor(event.magnitude);
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

function spawnRing(
  viewer: Viewer,
  longitude: number,
  latitude: number,
  color: Color,
  maxRadiusM: number,
  durationMs: number,
  outlineWidth: number
): void {
  const start = performance.now();
  let currentRadius = 1;
  const radiusMajor = () => {
    const progress = Math.min(1, (performance.now() - start) / durationMs);
    currentRadius = Math.max(1, progress * maxRadiusM);
    return currentRadius;
  };

  const radiusMinor = () => {
    // Retornamos el radio actual con un levísimo decremento para asegurar
    // que NUNCA sea mayor que el semiMajorAxis, evitando el DeveloperError de Cesium.
    return Math.max(1, currentRadius - 0.001);
  };

  const progressProp = () => Math.min(1, (performance.now() - start) / durationMs);

  const ring = viewer.entities.add({
    id: `ripple-${start}-${color.toCssHexString()}-${Math.random().toString(36).slice(2)}`,
    position: Cartesian3.fromDegrees(longitude, latitude),
    ellipse: {
      height: 0,
      semiMajorAxis: new CallbackProperty(radiusMajor, false),
      semiMinorAxis: new CallbackProperty(radiusMinor, false),
      fill: true,
      material: new ColorMaterialProperty(
        new CallbackProperty(() => color.withAlpha((1 - progressProp()) * 0.08), false)
      ),
      outline: true,
      outlineColor: new CallbackProperty(() => color.withAlpha((1 - progressProp()) * 0.95), false),
      outlineWidth
    }
  });

  window.setTimeout(() => {
    if (!viewer.isDestroyed()) {
      viewer.entities.remove(ring);
    }
  }, durationMs + 120);
}

function spawnWavefront(viewer: Viewer, longitude: number, latitude: number): void {
  spawnRing(viewer, longitude, latitude, WAVE_P_COLOR, 520_000, 1800, 2);
  spawnRing(viewer, longitude, latitude, WAVE_S_COLOR, 300_000, 2800, 3);
}

function setupBasemap(viewer: Viewer): void {
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

export function MapPanel({ disasters, events, selectedEventId, onSelect }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const eventMapRef = useRef<Map<string, SeismicEvent>>(new Map());
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
    | null
  >(null);

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
    scene.globe.enableLighting = false;
    scene.globe.showGroundAtmosphere = true;
    scene.globe.depthTestAgainstTerrain = false;
    scene.globe.baseColor = Color.fromCssColorString("#0b1220");
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.show = true;
    }
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
      if (defined(picked) && picked.id instanceof Entity && typeof picked.id.id === "string") {
        if (eventMapRef.current.has(picked.id.id)) {
          onSelectRef.current(picked.id.id);
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((movement: ScreenSpaceEventHandler.MotionEvent) => {
      const picked = viewer.scene.pick(movement.endPosition);
      const id = defined(picked) && picked.id instanceof Entity ? picked.id.id : undefined;
      const event = typeof id === "string" ? eventMapRef.current.get(id) : undefined;
      const context = typeof id === "string" ? disasterMapRef.current.get(id) : undefined;

      if (event) {
        const rect = canvas.getBoundingClientRect();
        setHover({
          kind: "event",
          event,
          x: rect.left + movement.endPosition.x,
          y: rect.top + movement.endPosition.y
        });
        canvas.style.cursor = "pointer";
      } else if (context) {
        const rect = canvas.getBoundingClientRect();
        setHover({
          kind: "disaster",
          context,
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

    setupBasemap(viewer);
    void loadPlateBoundaries(viewer);

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
        (entity.id.startsWith("ripple-") || entity.id.startsWith(DISASTER_PREFIX))
      )
        continue;
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
        spawnWavefront(viewer, event.longitude, event.latitude);
      }
    }

    collection.resumeEvents();
    initializedRef.current = true;
  }, [events]);

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
      if (typeof entity.id !== "string" || entity.id.startsWith("ripple-")) continue;
      const event = eventMapRef.current.get(entity.id);
      if (event) {
        styleEntity(entity, event, entity.id === selectedEventId);
      }
    }

    if (selectedEventId) {
      const event = eventMapRef.current.get(selectedEventId);
      if (event) {
        stopSpinRef.current?.();
        void viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(event.longitude, event.latitude, 1_800_000),
          orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
          duration: 1.0
        });
        spawnWavefront(viewer, event.longitude, event.latitude);
        selectionWaveTimerRef.current = window.setInterval(() => {
          if (viewer.isDestroyed()) return;
          const activeId = selectedIdRef.current;
          if (!activeId) return;
          const activeEvent = eventMapRef.current.get(activeId);
          if (!activeEvent) return;
          spawnWavefront(viewer, activeEvent.longitude, activeEvent.latitude);
        }, SELECTION_WAVE_INTERVAL_MS);
      }
    }
  }, [selectedEventId]);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-canvas cesium-canvas" />
      {hover?.kind === "event" ? (
        <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{getEventPlace(hover.event.title)}</strong>
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
            GDACS {hover.context.alertLevel ?? "N/D"} · score {hover.context.alertScore ?? "N/D"}
          </span>
          <span>{formatUtcDateTime(hover.context.eventTimeUtc)} UTC</span>
        </div>
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
          <i className="legend-point" style={{ background: "#ff9f1c" }} />
          Contexto GDACS
        </span>
      </div>
      <div className="map-legend legend-intensity">
        <span className="legend-title">Magnitud</span>
        {MAG_BANDS.map((band) => (
          <span className="legend-row" key={band.label}>
            <i className="legend-swatch" style={{ background: band.color }} />
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
}
