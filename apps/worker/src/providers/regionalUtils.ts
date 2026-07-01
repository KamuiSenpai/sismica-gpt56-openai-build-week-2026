import { createHash } from "node:crypto";

export function finiteNumber(value: unknown): number | null {
  const text = String(value ?? "")
    .replace(",", ".")
    .trim();
  if (!text) return null;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function collapseSpaces(value: string | null | undefined): string | null {
  const collapsed = value
    ?.replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed ? decodeHtml(collapsed) : null;
}

export function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "));
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&deg;/gi, "\u00b0")
    .replace(/&ordm;/gi, "\u00ba")
    .replace(/&aacute;/gi, "\u00e1")
    .replace(/&eacute;/gi, "\u00e9")
    .replace(/&iacute;/gi, "\u00ed")
    .replace(/&oacute;/gi, "\u00f3")
    .replace(/&uacute;/gi, "\u00fa")
    .replace(/&ntilde;/gi, "\u00f1")
    .replace(/&uuml;/gi, "\u00fc")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function isValidCoordinate(latitude: number | null, longitude: number | null): boolean {
  return (
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function localDateTimeToUtc(
  datePart: string,
  timePart: string,
  offset: "-03:00" | "-05:00" | "-06:00"
): string | null {
  const normalizedDate = datePart.trim().replaceAll("/", "-");
  const normalizedTime = timePart.trim().length === 5 ? `${timePart.trim()}:00` : timePart.trim();
  const parsed = new Date(`${normalizedDate}T${normalizedTime}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function stableSourceId(parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "na")).join("|"))
    .digest("hex")
    .slice(0, 24);
}

export function extractTableCells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => collapseSpaces(stripHtml(match[1])) ?? "")
    .filter((cell) => cell.length > 0);
}

export function absoluteUrl(baseUrl: string, value: string | null | undefined): string | null {
  const clean = collapseSpaces(value)?.replace(/^["']|["']$/g, "");
  if (!clean) return null;
  try {
    return new URL(clean, baseUrl).toString();
  } catch {
    return null;
  }
}
