import { useQuery } from "@tanstack/react-query";

import { type SeismicEvent } from "@sismica/shared";

import {
  fetchActiveDisasters,
  fetchActiveTsunamiProducts,
  fetchEvents,
  fetchStations,
  fetchSourceStatuses
} from "../lib/api";

const REFRESH_MS = 60_000;

// Clave de cache de eventos (usada tambien para inyectar eventos de SSE).
export function eventsQueryKey(minMagnitude: number, hours: number) {
  return ["events", minMagnitude, hours] as const;
}

export function useEventsQuery(minMagnitude: number, hours: number) {
  return useQuery({
    queryKey: eventsQueryKey(minMagnitude, hours),
    queryFn: () => fetchEvents({ minMagnitude, hours }),
    refetchInterval: REFRESH_MS
  });
}

export function useSourceStatusesQuery() {
  return useQuery({
    queryKey: ["source-status"],
    queryFn: fetchSourceStatuses,
    refetchInterval: REFRESH_MS
  });
}

export function useDisastersQuery() {
  return useQuery({
    queryKey: ["disasters"],
    queryFn: fetchActiveDisasters,
    refetchInterval: REFRESH_MS
  });
}

export function useTsunamiQuery() {
  return useQuery({
    queryKey: ["tsunami"],
    queryFn: fetchActiveTsunamiProducts,
    refetchInterval: REFRESH_MS
  });
}

export function useStationsQuery() {
  return useQuery({
    queryKey: ["stations"],
    queryFn: fetchStations,
    refetchInterval: 5 * REFRESH_MS
  });
}

// Aplica un evento entrante (SSE) sobre la lista cacheada, con el mismo
// criterio de filtro/merge que el polling.
export function mergeIncomingEvent(
  current: SeismicEvent[] | undefined,
  incoming: SeismicEvent,
  minMagnitude: number
): SeismicEvent[] {
  const list = current ?? [];
  if (incoming.magnitude !== null && incoming.magnitude < minMagnitude) return list;
  const exists = list.some((item) => item.eventId === incoming.eventId);
  if (exists) return list.map((item) => (item.eventId === incoming.eventId ? incoming : item));
  return [incoming, ...list].slice(0, 100);
}
