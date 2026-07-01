import { useEffect } from "react";
import { type StationState } from "@sismica/shared";

import { buildStationStreamUrl } from "../lib/api";

export function useStationStream(onState: (state: StationState) => void): void {
  useEffect(() => {
    const source = new EventSource(buildStationStreamUrl());
    const handleState = (event: MessageEvent<string>) => {
      try {
        onState(JSON.parse(event.data) as StationState);
      } catch {
        // A malformed update is ignored; polling remains the recovery path.
      }
    };
    source.addEventListener("station.state", handleState as EventListener);
    return () => source.close();
  }, [onState]);
}
