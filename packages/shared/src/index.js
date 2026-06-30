export const DEFAULT_MIN_MAGNITUDE = 2.5;
export const DEFAULT_HOURS = 24;
export const DEFAULT_LIMIT = 100;
export function buildEventId(source, sourceEventId) {
    return `${source}:${sourceEventId}`;
}
export function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
export function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
//# sourceMappingURL=index.js.map