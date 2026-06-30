import { randomUUID } from "node:crypto";

import { type Response } from "express";
import { Client } from "pg";

import { env } from "../config/env.js";
import { type StreamEvent } from "@sismica/shared";

type SseClient = {
  id: string;
  response: Response;
};

export class StreamBroker {
  private readonly clients = new Map<string, SseClient>();
  private listener: Client | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    try {
      this.listener = new Client({ connectionString: env.databaseUrl });
      await this.listener.connect();
      await this.listener.query(`LISTEN ${env.streamChannel}`);
      this.listener.on("notification", (message) => {
        if (!message.payload) {
          return;
        }
        try {
          const parsed = JSON.parse(message.payload) as StreamEvent;
          if (parsed && (parsed.type === "event.created" || parsed.type === "event.updated") && parsed.payload) {
            this.broadcast(parsed.type, JSON.stringify(parsed.payload));
            return;
          }
        } catch {
          // Compatibilidad con notificaciones anteriores que enviaban el evento directamente.
        }
        this.broadcast("event.created", message.payload);
      });
    } catch (error) {
      console.warn("SSE listener unavailable. API started without database notifications.", error);
      if (this.listener) {
        await this.listener.end().catch(() => undefined);
        this.listener = null;
      }
    }
    this.heartbeat = setInterval(() => {
      this.broadcast("ping", JSON.stringify({ timestamp: new Date().toISOString() }));
    }, 20000);
  }

  register(response: Response): string {
    const id = randomUUID();
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": env.frontendOrigin
    });
    response.flushHeaders?.();
    response.write(`event: ready\ndata: ${JSON.stringify({ id })}\n\n`);
    this.clients.set(id, { id, response });
    return id;
  }

  unregister(id: string): void {
    const client = this.clients.get(id);
    if (!client) {
      return;
    }
    client.response.end();
    this.clients.delete(id);
  }

  async stop(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.listener) {
      await this.listener.end();
      this.listener = null;
    }
  }

  private broadcast(event: string, payload: string): void {
    for (const client of this.clients.values()) {
      client.response.write(`event: ${event}\ndata: ${payload}\n\n`);
    }
  }
}
