export type FixedStationPosition = {
  latitude: number;
  longitude: number;
};

const COORDINATE_EPSILON = 0.0000001;

export function resolveFixedStationPosition(
  positions: Map<string, FixedStationPosition>,
  stationId: string,
  incoming: FixedStationPosition
): { position: FixedStationPosition; ignoredChange: boolean } {
  const existing = positions.get(stationId);
  if (!existing) {
    const position = { latitude: incoming.latitude, longitude: incoming.longitude };
    positions.set(stationId, position);
    return { position, ignoredChange: false };
  }

  const ignoredChange =
    Math.abs(existing.latitude - incoming.latitude) > COORDINATE_EPSILON ||
    Math.abs(existing.longitude - incoming.longitude) > COORDINATE_EPSILON;
  return { position: existing, ignoredChange };
}
