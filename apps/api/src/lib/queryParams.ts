import {
  DEFAULT_HOURS,
  DEFAULT_LIMIT,
  DEFAULT_MIN_MAGNITUDE,
  clampNumber,
  type EventsQuery
} from "@sismica/shared";

export function parseEventsQuery(query: Record<string, string | undefined>): EventsQuery {
  const minMagnitude = Number(query.minMagnitude ?? DEFAULT_MIN_MAGNITUDE);
  const hours = Number(query.hours ?? DEFAULT_HOURS);
  const limit = Number(query.limit ?? DEFAULT_LIMIT);

  return {
    minMagnitude: clampNumber(Number.isFinite(minMagnitude) ? minMagnitude : DEFAULT_MIN_MAGNITUDE, 0, 10),
    hours: clampNumber(Number.isFinite(hours) ? hours : DEFAULT_HOURS, 1, 720),
    limit: clampNumber(Number.isFinite(limit) ? limit : DEFAULT_LIMIT, 1, 500)
  };
}

