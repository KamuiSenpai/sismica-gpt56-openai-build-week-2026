export type SeaLevelStationStatus = "online" | "delayed" | "offline";

export type SeaLevelStation = {
  stationCode: string;
  name: string;
  countryCode: string | null;
  countryName: string | null;
  latitude: number;
  longitude: number;
  sensor: string | null;
  unit: string | null;
  lastValue: number | null;
  lastObservationAtUtc: string | null;
  lastUpdatedAtUtc: string | null;
  sampleRateMinutes: number | null;
  status: SeaLevelStationStatus;
  sourceUrl: string;
  sourceLabel: string;
  connection: string | null;
  glossId: string | null;
  availableSensors: string[];
};

export type SeaLevelTrend = "rising" | "falling" | "stable" | "unknown";

export type SeaLevelSeriesPoint = {
  timeUtc: string;
  value: number;
};

export type SeaLevelSnapshotEntry = {
  stationCode: string;
  name: string;
  countryName: string | null;
  latitude: number;
  longitude: number;
  unit: string | null;
  status: SeaLevelStationStatus;
  lastValue: number | null;
  lastObservationAtUtc: string | null;
};

export type SeaLevelRecentMove = {
  stationCode: string;
  name: string;
  countryName: string | null;
  latitude: number;
  longitude: number;
  unit: string | null;
  previousValue: number;
  currentValue: number;
  deltaValue: number;
  observedAtUtc: string | null;
  trend: SeaLevelTrend;
};

export type SeaLevelStationSeries = {
  stationCode: string;
  sensor: string | null;
  unit: string | null;
  windowHours: number;
  points: SeaLevelSeriesPoint[];
  latestValue: number | null;
  latestObservationAtUtc: string | null;
  minValue: number | null;
  maxValue: number | null;
  rangeValue: number | null;
  changeValue: number | null;
  trend: SeaLevelTrend;
};

type IocStationRow = {
  Code?: string | null;
  Location?: string | null;
  country?: string | null;
  countryname?: string | null;
  Lat?: number | string | null;
  Lon?: number | string | null;
  lat?: number | string | null;
  lon?: number | string | null;
  sensor?: string | null;
  rate?: number | string | null;
  units?: string | null;
  lasttime?: string | null;
  lastupdate?: string | null;
  lastvalue?: number | string | null;
  connect?: string | null;
  GlossID?: string | null;
};

type IocSeriesRow = {
  slevel?: number | string | null;
  stime?: string | null;
  sensor?: string | null;
};

export const IOC_SEA_LEVEL_STATIONLIST_URL =
  "https://ioc-sealevelmonitoring.org/service.php?query=stationlist&showall=a&format=json&output=general";
export const IOC_SEA_LEVEL_DATA_URL = "https://ioc-sealevelmonitoring.org/service.php?query=data";
const SEA_LEVEL_MOVE_EPSILON = 0.005;
const SEA_LEVEL_MOVE_MAX_GAP_MS = 12 * 60 * 60 * 1000;

const IOC_SEA_LEVEL_STATION_URL = "https://www.ioc-sealevelmonitoring.org/station.php?code=";
const ONLINE_FLOOR_MINUTES = 15;
const DELAYED_WINDOW_MS = 24 * 60 * 60 * 1000;
const SENSOR_PRIORITY = [
  "rad",
  "ra2",
  "ras",
  "bub",
  "flt",
  "enc",
  "pwl",
  "wls",
  "bwl",
  "prs",
  "pr1",
  "pr2",
  "prt",
  "prte",
  "aqu",
  "stp",
  "ecs",
  "atm",
  "bat"
] as const;

function parseNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidSeaLevelValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && Math.abs(value) < 900;
}

function parseUtcLike(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const base = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const candidate = /(?:Z|[+-]\d{2}:\d{2})$/u.test(base) ? base : `${base}Z`;
  const time = Date.parse(candidate);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/_/g, " ").replace(/\s+/gu, " ").trim();
  if (!normalized) return null;
  const hasLower = /\p{Ll}/u.test(normalized);
  const hasUpper = /\p{Lu}/u.test(normalized);
  if (hasLower || !hasUpper) return normalized;
  return normalized.toLocaleLowerCase("es").replace(/\b\p{L}/gu, (match) => match.toLocaleUpperCase("es"));
}

function sensorPriority(sensor: string | null | undefined): number {
  const normalized = sensor?.trim().toLowerCase();
  const index = normalized ? SENSOR_PRIORITY.indexOf(normalized as (typeof SENSOR_PRIORITY)[number]) : -1;
  return index === -1 ? SENSOR_PRIORITY.length : index;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function observationTimeMs(row: IocStationRow): number {
  const observation = parseUtcLike(row.lasttime);
  const updated = parseUtcLike(row.lastupdate);
  const observationMs = observation ? Date.parse(observation) : Number.NEGATIVE_INFINITY;
  const updatedMs = updated ? Date.parse(updated) : Number.NEGATIVE_INFINITY;
  return Math.max(observationMs, updatedMs);
}

function stationStatus(row: IocStationRow, nowMs: number): SeaLevelStationStatus {
  const observedAtMs = observationTimeMs(row);
  if (!Number.isFinite(observedAtMs)) return "offline";

  const rateMinutes = parseNumber(row.rate) ?? 0;
  const onlineWindowMs = Math.max(rateMinutes * 4, ONLINE_FLOOR_MINUTES) * 60 * 1000;
  const ageMs = Math.max(0, nowMs - observedAtMs);
  if (ageMs <= onlineWindowMs) return "online";
  if (ageMs <= DELAYED_WINDOW_MS) return "delayed";
  return "offline";
}

function bestRow(rows: IocStationRow[]): IocStationRow {
  return [...rows].sort((left, right) => {
    const sensorDelta = sensorPriority(left.sensor) - sensorPriority(right.sensor);
    if (sensorDelta !== 0) return sensorDelta;

    const leftHasValue = parseNumber(left.lastvalue) === null ? 1 : 0;
    const rightHasValue = parseNumber(right.lastvalue) === null ? 1 : 0;
    if (leftHasValue !== rightHasValue) return leftHasValue - rightHasValue;

    return observationTimeMs(right) - observationTimeMs(left);
  })[0];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveTrend(points: SeaLevelSeriesPoint[], rangeValue: number | null): SeaLevelTrend {
  if (points.length < 3) return "unknown";
  const anchorSize = Math.min(12, Math.max(3, Math.floor(points.length * 0.1)));
  const firstAverage = average(points.slice(0, anchorSize).map((point) => point.value));
  const lastAverage = average(points.slice(-anchorSize).map((point) => point.value));
  if (firstAverage === null || lastAverage === null) return "unknown";

  const delta = lastAverage - firstAverage;
  const threshold = Math.max(0.02, (rangeValue ?? 0) * 0.12);
  if (Math.abs(delta) < threshold) return "stable";
  return delta > 0 ? "rising" : "falling";
}

export function trendFromSeaLevelDelta(deltaValue: number, epsilon = SEA_LEVEL_MOVE_EPSILON): SeaLevelTrend {
  if (!Number.isFinite(deltaValue)) return "unknown";
  if (Math.abs(deltaValue) < epsilon) return "stable";
  return deltaValue > 0 ? "rising" : "falling";
}

export function normalizeSeaLevelStations(rows: unknown, nowMs = Date.now()): SeaLevelStation[] {
  if (!Array.isArray(rows)) return [];

  const grouped = new Map<string, IocStationRow[]>();
  for (const row of rows as IocStationRow[]) {
    const stationCode = typeof row.Code === "string" ? row.Code.trim().toLowerCase() : "";
    const latitude = parseNumber(row.Lat ?? row.lat);
    const longitude = parseNumber(row.Lon ?? row.lon);
    if (!stationCode || latitude === null || longitude === null) continue;

    const bucket = grouped.get(stationCode);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(stationCode, [row]);
    }
  }

  return [...grouped.entries()]
    .map(([stationCode, stationRows]) => {
      const selected = bestRow(stationRows);
      const latitude = parseNumber(selected.Lat ?? selected.lat);
      const longitude = parseNumber(selected.Lon ?? selected.lon);
      if (latitude === null || longitude === null) return null;

      return {
        stationCode,
        name: normalizeLabel(selected.Location) ?? stationCode.toUpperCase(),
        countryCode: normalizeLabel(selected.country)?.toUpperCase() ?? null,
        countryName: normalizeLabel(selected.countryname),
        latitude,
        longitude,
        sensor: selected.sensor?.trim().toLowerCase() ?? null,
        unit: normalizeLabel(selected.units)?.toUpperCase() ?? null,
        lastValue: parseNumber(selected.lastvalue),
        lastObservationAtUtc: parseUtcLike(selected.lasttime),
        lastUpdatedAtUtc: parseUtcLike(selected.lastupdate),
        sampleRateMinutes: parseNumber(selected.rate),
        status: stationStatus(selected, nowMs),
        sourceUrl: `${IOC_SEA_LEVEL_STATION_URL}${encodeURIComponent(stationCode)}`,
        sourceLabel: "UNESCO/IOC Sea Level Monitoring",
        connection: normalizeLabel(selected.connect),
        glossId: normalizeLabel(selected.GlossID),
        availableSensors: [
          ...new Set(stationRows.map((row) => row.sensor?.trim().toLowerCase()).filter(isNonEmptyString))
        ]
      } satisfies SeaLevelStation;
    })
    .filter((station): station is SeaLevelStation => station !== null)
    .sort((left, right) => {
      if (left.status !== right.status) {
        const order: Record<SeaLevelStationStatus, number> = { online: 0, delayed: 1, offline: 2 };
        return order[left.status] - order[right.status];
      }
      if ((left.countryName ?? "") !== (right.countryName ?? "")) {
        return (left.countryName ?? "").localeCompare(right.countryName ?? "", "es");
      }
      return left.name.localeCompare(right.name, "es");
    });
}

export function normalizeSeaLevelSeries(
  rows: unknown,
  input: { stationCode: string; sensor?: string | null; unit?: string | null; windowHours: number }
): SeaLevelStationSeries {
  const expectedSensor = input.sensor?.trim().toLowerCase() ?? null;
  const points = (Array.isArray(rows) ? rows : [])
    .map((row) => row as IocSeriesRow)
    .map((row) => {
      const sensor = row.sensor?.trim().toLowerCase() ?? null;
      const value = parseNumber(row.slevel);
      const timeUtc = parseUtcLike(row.stime);
      if (timeUtc === null || !isValidSeaLevelValue(value)) return null;
      if (expectedSensor !== null && sensor !== expectedSensor) return null;
      return { timeUtc, value };
    })
    .filter((point): point is SeaLevelSeriesPoint => point !== null)
    .sort((left, right) => Date.parse(left.timeUtc) - Date.parse(right.timeUtc));

  const latest = points.at(-1) ?? null;
  const minValue = points.length > 0 ? Math.min(...points.map((point) => point.value)) : null;
  const maxValue = points.length > 0 ? Math.max(...points.map((point) => point.value)) : null;
  const rangeValue =
    minValue !== null && maxValue !== null ? Math.max(0, Number((maxValue - minValue).toFixed(4))) : null;
  const changeValue =
    points.length >= 2 ? Number((points[points.length - 1].value - points[0].value).toFixed(4)) : null;

  return {
    stationCode: input.stationCode,
    sensor: expectedSensor,
    unit: input.unit ?? null,
    windowHours: input.windowHours,
    points,
    latestValue: latest?.value ?? null,
    latestObservationAtUtc: latest?.timeUtc ?? null,
    minValue,
    maxValue,
    rangeValue,
    changeValue,
    trend: resolveTrend(points, rangeValue)
  };
}

export function buildSeaLevelSnapshot(stations: SeaLevelStation[]): Record<string, SeaLevelSnapshotEntry> {
  return Object.fromEntries(
    stations.map((station) => [
      station.stationCode,
      {
        stationCode: station.stationCode,
        name: station.name,
        countryName: station.countryName,
        latitude: station.latitude,
        longitude: station.longitude,
        unit: station.unit,
        status: station.status,
        lastValue: station.lastValue,
        lastObservationAtUtc: station.lastObservationAtUtc
      } satisfies SeaLevelSnapshotEntry
    ])
  );
}

export function detectSeaLevelRecentMoves(
  stations: SeaLevelStation[],
  previousSnapshot: Record<string, SeaLevelSnapshotEntry>,
  epsilon = SEA_LEVEL_MOVE_EPSILON
): SeaLevelRecentMove[] {
  const moves: Array<SeaLevelRecentMove | null> = stations.map((station) => {
    const previous = previousSnapshot[station.stationCode];
    if (!previous) return null;
    if (
      station.lastObservationAtUtc === null ||
      previous.lastObservationAtUtc === null ||
      station.lastObservationAtUtc === previous.lastObservationAtUtc
    ) {
      return null;
    }
    const currentObservedAt = Date.parse(station.lastObservationAtUtc);
    const previousObservedAt = Date.parse(previous.lastObservationAtUtc);
    if (
      !Number.isFinite(currentObservedAt) ||
      !Number.isFinite(previousObservedAt) ||
      currentObservedAt - previousObservedAt > SEA_LEVEL_MOVE_MAX_GAP_MS
    ) {
      return null;
    }
    if (!isValidSeaLevelValue(station.lastValue) || !isValidSeaLevelValue(previous.lastValue)) return null;

    const deltaValue = Number((station.lastValue - previous.lastValue).toFixed(4));
    const trend = trendFromSeaLevelDelta(deltaValue, epsilon);
    if (trend === "stable") return null;

    return {
      stationCode: station.stationCode,
      name: station.name,
      countryName: station.countryName,
      latitude: station.latitude,
      longitude: station.longitude,
      unit: station.unit,
      previousValue: previous.lastValue,
      currentValue: station.lastValue,
      deltaValue,
      observedAtUtc: station.lastObservationAtUtc,
      trend
    } satisfies SeaLevelRecentMove;
  });

  return moves
    .filter((move): move is SeaLevelRecentMove => move !== null)
    .sort((left, right) => Math.abs(right.deltaValue) - Math.abs(left.deltaValue));
}
