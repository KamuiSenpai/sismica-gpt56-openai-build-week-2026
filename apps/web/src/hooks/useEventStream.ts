import { useEffect, useRef, useState } from "react";

import { type SeismicEvent, type StreamEvent } from "@sismica/shared";

import { buildStreamUrl } from "../lib/api";

type ConnectionState = "connecting" | "open" | "closed" | "error";

export function useEventStream(onEvent: (event: SeismicEvent) => void) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const source = new EventSource(buildStreamUrl());

    source.addEventListener("open", () => {
      setConnectionState("open");
    });

    source.addEventListener("error", () => {
      setConnectionState("error");
    });

    const handleSeismicEvent = (message: Event) => {
      const parsed = JSON.parse((message as MessageEvent<string>).data) as StreamEvent["payload"];
      onEventRef.current(parsed);
    };

    source.addEventListener("event.created", handleSeismicEvent);
    source.addEventListener("event.updated", handleSeismicEvent);

    source.addEventListener("ping", () => {
      setConnectionState("open");
    });

    return () => {
      setConnectionState("closed");
      source.close();
    };
  }, []);

  return connectionState;
}
