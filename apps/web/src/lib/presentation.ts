import { type SeismicEvent } from "@sismica/shared";

type EventQualityTone = "quality-a" | "quality-b" | "quality-c" | "quality-v";

type EventStatusBadge = {
  label: string;
  tone: EventQualityTone;
  description: string;
};

const MAGNITUDE_PREFIX = /^M\s*\d+(?:\.\d+)?\s*-\s*/i;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toUtcDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatUtcDateTime(value: string | null | undefined): string {
  const parsed = toUtcDate(value);
  if (!parsed) {
    return "--";
  }

  return [
    `${pad(parsed.getUTCDate())}/${pad(parsed.getUTCMonth() + 1)}/${parsed.getUTCFullYear()}`,
    `${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}:${pad(parsed.getUTCSeconds())}`
  ].join(" ");
}

export function formatUtcClock(value: Date): string {
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
}

export function formatMagnitude(value: number | null | undefined): string {
  return typeof value === "number" ? `M${value.toFixed(1)}` : "M?";
}

export function formatDepth(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(0)} km` : "-- km";
}

export function formatCoordinate(value: number, axis: "lat" | "lon"): string {
  const suffix = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(3)}${suffix}`;
}

export function getEventPlace(title: string): string {
  const normalized = title.replace(MAGNITUDE_PREFIX, "").trim();
  return normalized || title;
}

export const EVENT_STATUS_LEGEND: EventStatusBadge[] = [
  { label: "A", tone: "quality-c", description: "Automatico" },
  { label: "O", tone: "quality-a", description: "Oficial" },
  { label: "R", tone: "quality-a", description: "Revisado" },
  { label: "P", tone: "quality-b", description: "Preliminar" },
  { label: "V", tone: "quality-v", description: "Validation" },
  { label: "?", tone: "quality-b", description: "Sin estado" }
];

export function getEventStatusBadge(status: SeismicEvent["status"]): EventStatusBadge {
  const normalized = status?.toLowerCase();
  switch (normalized) {
    case "reviewed":
      return { label: "R", tone: "quality-a", description: "Revisado" };
    case "automatic":
      return { label: "A", tone: "quality-c", description: "Automatico" };
    case "official":
      return { label: "O", tone: "quality-a", description: "Oficial" };
    case "preliminary":
      return { label: "P", tone: "quality-b", description: "Preliminar" };
    case "validation":
      return { label: "V", tone: "quality-v", description: "Validation" };
    default:
      return { label: "?", tone: "quality-b", description: normalized ?? "Sin estado" };
  }
}

export function formatMetric(value: number | null | undefined, unit = "", decimals = 1): string {
  return typeof value === "number" ? `${value.toFixed(decimals)}${unit}` : "N/D";
}
