import cors from "cors";
import express from "express";
import { LRUCache } from "lru-cache";

import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { parseEventsQuery } from "./lib/queryParams.js";
import { getActiveDisasters, getActiveTsunamiProducts } from "./services/contextRepository.js";
import { getEventById, getEventReferences, getEvents } from "./services/eventRepository.js";
import { getSourceStatuses } from "./services/sourceStatusRepository.js";
import { StreamBroker } from "./services/streamBroker.js";

export function createApp(streamBroker: StreamBroker) {
  const app = express();
  
  const eventsCache = new LRUCache<string, { items: Awaited<ReturnType<typeof getEvents>>; query: ReturnType<typeof parseEventsQuery> }>({
    max: 100,
    ttl: 5000 // 5 seconds micro-caching
  });

  app.use(cors({ origin: env.frontendOrigin }));
  app.use(express.json());

  app.get("/api/health", async (_request, response) => {
    try {
      await pool.query("SELECT 1");
      response.json({
        ok: true,
        service: "api",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        service: "api",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/events", async (request, response) => {
    try {
      const query = parseEventsQuery({
        minMagnitude: typeof request.query.minMagnitude === "string" ? request.query.minMagnitude : undefined,
        hours: typeof request.query.hours === "string" ? request.query.hours : undefined,
        limit: typeof request.query.limit === "string" ? request.query.limit : undefined
      });

      const cacheKey = JSON.stringify(query);
      const cached = eventsCache.get(cacheKey);
      if (cached) {
        response.json(cached);
        return;
      }

      const events = await getEvents(pool, query);
      const result = { items: events, query };
      eventsCache.set(cacheKey, result);

      response.json(result);
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/events/:eventId", async (request, response) => {
    try {
      const event = await getEventById(pool, request.params.eventId);
      if (!event) {
        response.status(404).json({ error: "Event not found" });
        return;
      }
      const references = await getEventReferences(pool, request.params.eventId);
      response.json({ ...event, references });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/sources/status", async (_request, response) => {
    try {
      const sources = await getSourceStatuses(pool);
      response.json({ items: sources });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/disasters/active", async (_request, response) => {
    try {
      response.json({ items: await getActiveDisasters(pool) });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/tsunami/active", async (_request, response) => {
    try {
      response.json({ items: await getActiveTsunamiProducts(pool) });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/stream", (request, response) => {
    const id = streamBroker.register(response);
    request.on("close", () => {
      streamBroker.unregister(id);
    });
  });

  return app;
}
