import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { locate, type PhasePick } from "./locator.js";
import { pTravelTimeSeconds, surfaceDistanceKm } from "./velocityModel.js";

// Identificador del motor experimental (queda en la telemetria y en cada origen).
const ENGINE = "sismica-sim/0.1";
// Solo se procesan eventos con una estacion GE dentro de este radio: garantiza que la
// busqueda en malla (anclada en la estacion mas cercana, +-12 grados) contenga el epicentro.
const MAX_ANCHOR_KM = 1200;

type StationRow = {
  station_id: string;
  network_code: string;
  station_code: string;
  latitude: number;
  longitude: number;
};

type EventRow = {
  event_id: string;
  magnitude: number | null;
  depth_km: number;
  latitude: number;
  longitude: number;
  event_time_utc: Date;
};

export type SeismicEngineSummary = {
  status: "ok" | "skipped";
  reason?: string;
  processedEvents: number;
  publishedOrigins: number;
  triggeredStations: number;
};

// Ruido de pick determinista en [-0.3, 0.3] s a partir de una semilla textual: mantiene
// los origenes idempotentes entre ciclos (mismo evento -> mismo resultado).
function deterministicJitter(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 1000) / 1000; // [0, 1)
  return (unit - 0.5) * 0.6;
}

function classifyQuality(rmsSec: number, gapDeg: number): "acceptable" | "preliminary" | "rejected" {
  if (rmsSec <= 0.8 && gapDeg <= 200) return "acceptable";
  if (rmsSec <= 1.8) return "preliminary";
  return "rejected";
}

async function loadStations(): Promise<StationRow[]> {
  const result = await pool.query<StationRow>(
    `SELECT station_id, network_code, station_code, latitude, longitude
       FROM seismic_stations
      WHERE source = 'GEOFON'`
  );
  return result.rows;
}

async function loadRecentEvents(limit: number): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `SELECT event_id, magnitude, depth_km,
            ST_Y(geom::geometry) AS latitude,
            ST_X(geom::geometry) AS longitude,
            event_time_utc
       FROM seismic_events
      WHERE depth_km IS NOT NULL
      ORDER BY event_time_utc DESC
      LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function postJson(path: string, body: unknown, token: string): Promise<void> {
  const response = await fetch(`${env.seismicEngineApiUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-seismic-engine-token": token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.sourceTimeoutMs)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
}

type StatePayload = {
  stationId: string;
  status: "triggered";
  phase: "P";
  latencyMs: number;
  triggerValue: number;
  observedAtUtc: string;
  sequence: number;
};

type PickPayload = {
  pickId: string;
  stationId: string;
  phase: "P";
  pickTimeUtc: string;
  snr: number;
  algorithm: string;
};

// Toma un evento real como "verdad", modela los tiempos de llegada P en las estaciones GE
// mas cercanas, y devuelve los picks (para triangular) y sus payloads de telemetria.
function simulateEvent(
  event: EventRow,
  stations: StationRow[],
  maxStations: number,
  observedAtUtc: string,
  sequence: number
): { picks: PhasePick[]; states: StatePayload[]; pickPayloads: PickPayload[] } | null {
  const originTimeSeconds = event.event_time_utc.getTime() / 1000;
  const ranked = stations
    .map((station) => ({
      station,
      surfaceKm: surfaceDistanceKm(event.latitude, event.longitude, station.latitude, station.longitude)
    }))
    .sort((left, right) => left.surfaceKm - right.surfaceKm)
    .slice(0, maxStations);

  if (ranked.length < 4 || ranked[0].surfaceKm > MAX_ANCHOR_KM) return null;

  const picks: PhasePick[] = [];
  const states: StatePayload[] = [];
  const pickPayloads: PickPayload[] = [];

  for (const { station, surfaceKm } of ranked) {
    const jitter = deterministicJitter(`${event.event_id}:${station.station_id}`);
    const travel = pTravelTimeSeconds(surfaceKm, event.depth_km);
    const arrivalSeconds = originTimeSeconds + travel + jitter;
    const pickTimeUtc = new Date(arrivalSeconds * 1000).toISOString();
    const snr = Number((20 / (1 + surfaceKm / 200)).toFixed(2));

    picks.push({
      stationId: station.station_id,
      latitude: station.latitude,
      longitude: station.longitude,
      timeSeconds: arrivalSeconds
    });
    states.push({
      stationId: station.station_id,
      status: "triggered",
      phase: "P",
      latencyMs: 200 + Math.round(surfaceKm / 8),
      triggerValue: snr,
      observedAtUtc,
      sequence
    });
    pickPayloads.push({
      pickId: `${ENGINE}:${event.event_id}:${station.station_id}`,
      stationId: station.station_id,
      phase: "P",
      pickTimeUtc,
      snr,
      algorithm: "forward-model+grid-search/0.1"
    });
  }

  return { picks, states, pickPayloads };
}

// Ejecuta un ciclo completo del motor: lee estaciones y eventos reales, modela picks,
// triangula un origen por evento y publica todo por el adaptador interno autenticado.
export async function runSeismicEngineCycle(): Promise<SeismicEngineSummary> {
  const empty: SeismicEngineSummary = {
    status: "skipped",
    processedEvents: 0,
    publishedOrigins: 0,
    triggeredStations: 0
  };

  if (!env.seismicEngineEnabled) return { ...empty, reason: "disabled" };
  const token = env.seismicEngineToken;
  if (!token) return { ...empty, reason: "missing SEISMIC_ENGINE_TOKEN" };

  const stations = await loadStations();
  if (stations.length < 4) return { ...empty, reason: "station catalog incomplete" };

  const events = await loadRecentEvents(env.seismicEngineMaxEvents * 4);
  if (events.length === 0) return { ...empty, reason: "no locatable events" };

  const observedAtUtc = new Date().toISOString();
  const sequence = Date.now();
  const stateByStation = new Map<string, StatePayload>();
  const pickById = new Map<string, PickPayload>();
  const origins: unknown[] = [];

  for (const event of events) {
    if (origins.length >= env.seismicEngineMaxEvents) break;
    const simulated = simulateEvent(event, stations, env.seismicEngineMaxStations, observedAtUtc, sequence);
    if (!simulated) continue;

    const estimate = locate(simulated.picks);
    if (!estimate) continue;

    for (const state of simulated.states) {
      const existing = stateByStation.get(state.stationId);
      if (!existing || state.triggerValue > existing.triggerValue) stateByStation.set(state.stationId, state);
    }
    for (const pick of simulated.pickPayloads) pickById.set(pick.pickId, pick);

    const magnitude =
      event.magnitude !== null && event.magnitude >= -2 && event.magnitude <= 10
        ? event.magnitude
        : undefined;

    origins.push({
      schemaVersion: 1,
      originId: `${ENGINE}:${event.event_id}`,
      engine: ENGINE,
      originTimeUtc: new Date(estimate.originTimeSeconds * 1000).toISOString(),
      latitude: Number(estimate.latitude.toFixed(4)),
      longitude: Number(estimate.longitude.toFixed(4)),
      depthKm: Number(Math.min(800, Math.max(0, estimate.depthKm)).toFixed(1)),
      magnitude,
      stationCount: estimate.stationCount,
      rmsSec: Number(estimate.rmsSeconds.toFixed(3)),
      azimuthalGapDeg: Number(estimate.azimuthalGapDeg.toFixed(1)),
      quality: classifyQuality(estimate.rmsSeconds, estimate.azimuthalGapDeg),
      status: estimate.stationCount >= 4 ? "located" : "candidate",
      officialEventId: event.event_id
    });
  }

  if (origins.length === 0) return { ...empty, reason: "no events with local station coverage" };

  const states = [...stateByStation.values()];
  const picks = [...pickById.values()];
  await postJson(
    "/internal/seismic-engine/snapshots",
    { schemaVersion: 1, engine: ENGINE, states, picks },
    token
  );
  for (const origin of origins) {
    await postJson("/internal/seismic-engine/origins", origin, token);
  }

  return {
    status: "ok",
    processedEvents: origins.length,
    publishedOrigins: origins.length,
    triggeredStations: states.length
  };
}
