import cors from "cors";
import express from "express";
import { LRUCache } from "lru-cache";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { parseEventsQuery } from "./lib/queryParams.js";
import { getActiveDisasters, getActiveTsunamiProducts } from "./services/contextRepository.js";
import {
  getEventById,
  getEventReferences,
  getEvents,
  getTopMagnitudeEvents
} from "./services/eventRepository.js";
import { getSourceStatuses } from "./services/sourceStatusRepository.js";
import { StreamBroker } from "./services/streamBroker.js";
import { getStations, parseStationQuery } from "./services/stationRepository.js";
import { getSeismicPresenceSummary } from "./services/seismicPresenceRepository.js";
import {
  getExperimentalOrigins,
  parseExperimentalOriginQuery
} from "./services/experimentalOriginRepository.js";
import {
  experimentalOriginSchema,
  persistExperimentalOrigin,
  persistStationSnapshot,
  stationSnapshotSchema
} from "./services/seismicEngineRepository.js";
import {
  activateVoiceEngine,
  getHealth as getTtsHealth,
  getTtsRuntimeStats,
  synthesize as synthesizeTts,
  TtsBusyError,
  ttsEngineSchema,
  ttsRequestSchema,
  TtsUnavailableError,
  voiceEngineSchema
} from "./services/ttsService.js";
import {
  getTtsBridgeManifest,
  resolveTtsBridgeFile,
  type TtsBridgeLibrary
} from "./services/ttsBridgeService.js";
import { generateNarration, narrationRequestSchema } from "./services/narrationService.js";
import {
  generateHandoffSegment,
  generateSegment,
  handoffRequestSchema,
  segmentRequestSchema
} from "./services/segmentService.js";
import { decideNext, directorStateSchema } from "./services/directorService.js";
import {
  enqueueYoutubeChatTestMessage,
  getYoutubeChatMessages,
  getYoutubeChatStatus
} from "./services/youtubeChatRepository.js";

function hasValidEngineToken(candidate: string | undefined): boolean {
  if (!env.seismicEngineToken || !candidate) return false;
  const expectedHash = createHash("sha256").update(env.seismicEngineToken).digest();
  const candidateHash = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expectedHash, candidateHash);
}

export function createApp(streamBroker: StreamBroker) {
  const app = express();
  const youtubeChatTestSchema = z.object({
    text: z.string().trim().min(1).max(180)
  });
  const bridgeLibraries = new Set<TtsBridgeLibrary>([
    "short",
    "extended",
    "informative",
    "educational",
    "official-informative",
    "official-educational",
    "official-promotional"
  ]);
  const voiceTelemetry: Array<Record<string, string | number | null>> = [];
  let voiceTelemetrySequence = 0;
  let voiceOwner: { clientId: string; expiresAt: number } | null = null;
  const voiceOwnerLeaseMs = 12_000;

  const eventsCache = new LRUCache<
    string,
    { items: Awaited<ReturnType<typeof getEvents>>; query: ReturnType<typeof parseEventsQuery> }
  >({
    max: 100,
    ttl: 5000 // 5 seconds micro-caching
  });

  app.use(cors({ origin: env.frontendOrigin }));
  app.use(express.json({ limit: "2mb" }));

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

  app.get("/api/analytics/seismic-presence", async (_request, response) => {
    try {
      response.json(await getSeismicPresenceSummary(pool));
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/analytics/top-magnitude", async (request, response) => {
    try {
      const raw = typeof request.query.limit === "string" ? Number(request.query.limit) : 10;
      const limit = Number.isFinite(raw) ? Math.min(50, Math.max(1, Math.trunc(raw))) : 10;
      const items = await getTopMagnitudeEvents(pool, limit);
      response.json({ generatedAt: new Date().toISOString(), items });
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

  app.get("/api/tts/health", async (_request, response) => {
    try {
      response.json(await getTtsHealth());
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/tts/runtime", (_request, response) => {
    response.json(getTtsRuntimeStats());
  });

  app.put("/api/tts/owner", (request, response) => {
    const body =
      request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
    const clientId = typeof body.clientId === "string" ? body.clientId.slice(0, 80) : "";
    if (!clientId) {
      response.status(400).json({ error: "Cliente de voz invalido" });
      return;
    }
    const now = Date.now();
    if (voiceOwner && voiceOwner.clientId !== clientId && voiceOwner.expiresAt > now) {
      response.json({ granted: false, expiresAt: new Date(voiceOwner.expiresAt).toISOString() });
      return;
    }
    voiceOwner = { clientId, expiresAt: now + voiceOwnerLeaseMs };
    response.json({ granted: true, expiresAt: new Date(voiceOwner.expiresAt).toISOString() });
  });

  app.delete("/api/tts/owner/:clientId", (request, response) => {
    if (voiceOwner?.clientId === request.params.clientId) voiceOwner = null;
    response.json({ ok: true });
  });

  app.get("/api/tts/telemetry", (request, response) => {
    const rawSince = typeof request.query.since === "string" ? Number(request.query.since) : 0;
    const since = Number.isFinite(rawSince) ? Math.max(0, Math.trunc(rawSince)) : 0;
    response.json({
      latestSequence: voiceTelemetrySequence,
      items: voiceTelemetry.filter((item) => Number(item.sequence) > since)
    });
  });

  app.delete("/api/tts/telemetry", (_request, response) => {
    voiceTelemetry.length = 0;
    voiceTelemetrySequence = 0;
    response.json({ ok: true });
  });

  app.post("/api/tts/telemetry", (request, response) => {
    const body =
      request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
    const kind = typeof body.kind === "string" ? body.kind.slice(0, 40) : "";
    const clientId = typeof body.clientId === "string" ? body.clientId.slice(0, 80) : "";
    if (!kind || !clientId) {
      response.status(400).json({ error: "Telemetria de voz invalida" });
      return;
    }

    const record: Record<string, string | number | null> = {
      sequence: ++voiceTelemetrySequence,
      receivedAtUtc: new Date().toISOString(),
      clientId,
      kind
    };
    for (const key of [
      "eventId",
      "hostId",
      "engine",
      "voice",
      "library",
      "variant",
      "requestedGroupId",
      "selectedGroupId",
      "cacheState",
      "wordBucket",
      "reason",
      "outcome"
    ] as const) {
      const value = body[key];
      record[key] = typeof value === "string" ? value.slice(0, 160) : null;
    }
    record.durationMs =
      typeof body.durationMs === "number" && Number.isFinite(body.durationMs)
        ? Math.max(0, Math.round(body.durationMs))
        : null;
    record.wordCount =
      typeof body.wordCount === "number" && Number.isFinite(body.wordCount)
        ? Math.max(0, Math.round(body.wordCount))
        : null;
    record.clipText = typeof body.clipText === "string" ? body.clipText.slice(0, 1_600) : null;
    voiceTelemetry.push(record);
    if (voiceTelemetry.length > 1000) {
      voiceTelemetry.splice(0, voiceTelemetry.length - 1000);
    }
    response.status(202).json({ ok: true, sequence: record.sequence });
  });

  app.get("/api/tts/bridges/:library/manifest", async (request, response) => {
    const library = request.params.library;
    if (!bridgeLibraries.has(library as TtsBridgeLibrary)) {
      response.status(404).json({ error: "Biblioteca de puentes no encontrada" });
      return;
    }
    try {
      const manifest = await getTtsBridgeManifest(library as TtsBridgeLibrary);
      if (!manifest) {
        response.status(404).json({ error: "Manifest de puentes no disponible" });
        return;
      }
      response.setHeader("Cache-Control", "public, max-age=300");
      response.json(manifest);
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/tts/bridges/:library/:voice/:fileName", async (request, response) => {
    const library = request.params.library;
    if (!bridgeLibraries.has(library as TtsBridgeLibrary)) {
      response.status(404).json({ error: "Biblioteca de puentes no encontrada" });
      return;
    }
    try {
      const filePath = await resolveTtsBridgeFile(
        library as TtsBridgeLibrary,
        request.params.voice,
        request.params.fileName
      );
      if (!filePath) {
        response.status(404).json({ error: "Clip puente no encontrado" });
        return;
      }
      response.setHeader("Cache-Control", "public, max-age=86400");
      response.setHeader("Content-Type", "audio/wav");
      response.sendFile(filePath);
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/tts/engine", async (request, response) => {
    const engine = voiceEngineSchema.safeParse(request.body?.engine);
    if (!engine.success) {
      response.status(400).json({ error: "Motor de voz invalido" });
      return;
    }
    try {
      const health = await activateVoiceEngine(engine.data);
      response.json({ ok: true, engine: engine.data, health });
    } catch (error) {
      if (error instanceof TtsUnavailableError) {
        response.status(503).json({ error: error.message });
        return;
      }
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/tts", async (request, response) => {
    const engine = ttsEngineSchema.safeParse(request.query.engine);
    if (!engine.success) {
      response.status(400).json({ error: "El parametro 'engine' debe ser 'piper', 'xtts' o 'chatterbox'" });
      return;
    }
    const body = ttsRequestSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({ error: "Solicitud TTS invalida", issues: body.error.issues });
      return;
    }
    try {
      const result = await synthesizeTts(engine.data, body.data);
      response.setHeader("Content-Type", result.contentType);
      response.setHeader("Cache-Control", "public, max-age=86400");
      response.setHeader("X-TTS-Cache", result.cached ? "hit" : "miss");
      response.send(result.audio);
    } catch (error) {
      if (error instanceof TtsBusyError) {
        response.setHeader("Retry-After", "1");
        response.status(429).json({ error: error.message });
        return;
      }
      if (error instanceof TtsUnavailableError) {
        response.status(503).json({ error: error.message });
        return;
      }
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/narration", async (request, response) => {
    const parsed = narrationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Solicitud de narracion invalida", issues: parsed.error.issues });
      return;
    }
    try {
      response.json({ editorial: await generateNarration(parsed.data) });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/segment", async (request, response) => {
    const parsed = segmentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Solicitud de segmento invalida", issues: parsed.error.issues });
      return;
    }
    try {
      response.json(await generateSegment(parsed.data));
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/segment/handoff", async (request, response) => {
    const parsed = handoffRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Solicitud de relevo invalida", issues: parsed.error.issues });
      return;
    }
    try {
      response.json(await generateHandoffSegment(parsed.data));
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/director/decide", async (request, response) => {
    const parsed = directorStateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Estado del director invalido", issues: parsed.error.issues });
      return;
    }
    try {
      response.json(await decideNext(parsed.data));
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/youtube/chat/status", async (_request, response) => {
    try {
      response.json(await getYoutubeChatStatus(pool));
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/youtube/chat/messages", async (request, response) => {
    try {
      const raw = typeof request.query.limit === "string" ? Number(request.query.limit) : 50;
      const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.trunc(raw))) : 50;
      response.json({ items: await getYoutubeChatMessages(pool, limit) });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/youtube/chat/test", async (request, response) => {
    if (!env.youtubeChatEnabled) {
      response.status(503).json({ error: "YouTube chat is disabled" });
      return;
    }
    if (!env.seismicEngineToken) {
      response.status(503).json({ error: "Operator token is not configured" });
      return;
    }
    const token = request.header("x-seismic-engine-token");
    if (!hasValidEngineToken(token)) {
      response.status(401).json({ error: "Invalid operator token" });
      return;
    }

    const parsed = youtubeChatTestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid YouTube chat test request", issues: parsed.error.issues });
      return;
    }

    try {
      const item = await enqueueYoutubeChatTestMessage(pool, parsed.data.text);
      response.status(202).json({ item });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/stations", async (request, response) => {
    try {
      const query = parseStationQuery({
        bbox: typeof request.query.bbox === "string" ? request.query.bbox : undefined,
        status: typeof request.query.status === "string" ? request.query.status : undefined,
        network: typeof request.query.network === "string" ? request.query.network : undefined,
        activeAt: typeof request.query.activeAt === "string" ? request.query.activeAt : undefined,
        limit: typeof request.query.limit === "string" ? request.query.limit : undefined
      });
      const stations = await getStations(pool, query);
      response.json({
        generatedAt: new Date().toISOString(),
        items: stations,
        count: stations.length
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const invalidInput =
        message.includes("must") || message.includes("invalid") || message.includes("unsupported");
      response.status(invalidInput ? 400 : 500).json({ error: message });
    }
  });

  app.get("/api/stations/stream", (request, response) => {
    const id = streamBroker.registerStation(response);
    request.on("close", () => streamBroker.unregister(id));
  });

  app.get("/api/experimental-origins", async (request, response) => {
    try {
      const query = parseExperimentalOriginQuery({
        hours: typeof request.query.hours === "string" ? request.query.hours : undefined,
        limit: typeof request.query.limit === "string" ? request.query.limit : undefined
      });
      const origins = await getExperimentalOrigins(pool, query);
      response.json({ generatedAt: new Date().toISOString(), items: origins, count: origins.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const invalidInput = message.includes("must");
      response.status(invalidInput ? 400 : 500).json({ error: message });
    }
  });

  app.post("/internal/seismic-engine/snapshots", async (request, response) => {
    if (!env.seismicEngineToken) {
      response.status(503).json({ error: "Seismic engine adapter is not configured" });
      return;
    }
    const token = request.header("x-seismic-engine-token");
    if (!hasValidEngineToken(token)) {
      response.status(401).json({ error: "Invalid seismic engine token" });
      return;
    }
    const parsed = stationSnapshotSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid snapshot", issues: parsed.error.issues });
      return;
    }
    try {
      response.json(await persistStationSnapshot(pool, parsed.data));
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/internal/seismic-engine/origins", async (request, response) => {
    if (!env.seismicEngineToken) {
      response.status(503).json({ error: "Seismic engine adapter is not configured" });
      return;
    }
    const token = request.header("x-seismic-engine-token");
    if (!hasValidEngineToken(token)) {
      response.status(401).json({ error: "Invalid seismic engine token" });
      return;
    }
    const parsed = experimentalOriginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid origin", issues: parsed.error.issues });
      return;
    }
    try {
      response.json(await persistExperimentalOrigin(pool, parsed.data));
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
