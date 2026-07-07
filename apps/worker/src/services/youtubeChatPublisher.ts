import {
  hasYoutubeChatCredentials,
  insertYoutubeLiveChatMessage,
  resolveYoutubeLiveChat,
  type ResolvedYoutubeLiveChat,
  YoutubeApiError
} from "@sismica/shared";
import { type PoolClient } from "pg";

import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { enqueuePromotionalLikeYoutubeChatMessage } from "./youtubeChatQueueService.js";

const LIVE_CHAT_CACHE_TTL_MS = 30_000;
const RATE_LIMIT_REASONS = new Set(["quotaExceeded", "rateLimitExceeded", "userRequestsExceedRateLimit"]);
const CHAT_DISABLED_REASONS = new Set(["liveChatDisabled", "liveChatEnded", "liveChatNotFound", "notFound"]);

type PendingYoutubeChatMessage = {
  id: number;
  message_text: string;
  message_kind: "new_event" | "manual_test" | "promotional_like";
  enqueued_at_utc: Date;
  attempts: number;
};

export type YoutubeChatPublisherSummary = {
  status: "idle" | "blocked" | "posted" | "skipped" | "failed";
  reason: string;
  messageId: number | null;
  youtubeMessageId?: string | null;
};

type PublishErrorOutcome =
  | {
      status: "skipped";
      reason: "rate_limited" | "chat_disabled";
      invalidateCache: boolean;
      message: string;
    }
  | {
      status: "failed";
      reason: "api_error";
      invalidateCache: boolean;
      message: string;
    };

let liveChatCache: { expiresAt: number; value: ResolvedYoutubeLiveChat } | null = null;

function getYoutubeChatCredentials() {
  const credentials = {
    clientId: env.youtubeChatClientId ?? "",
    clientSecret: env.youtubeChatClientSecret ?? "",
    refreshToken: env.youtubeChatRefreshToken ?? "",
    channelId: env.youtubeChatChannelId ?? null
  };
  return hasYoutubeChatCredentials(credentials) ? credentials : null;
}

function invalidateLiveChatCache(): void {
  liveChatCache = null;
}

async function resolveCachedLiveChat(): Promise<ResolvedYoutubeLiveChat> {
  const now = Date.now();
  if (liveChatCache && liveChatCache.expiresAt > now) {
    return liveChatCache.value;
  }

  const credentials = getYoutubeChatCredentials();
  if (!credentials) {
    throw new Error("YouTube chat credentials are not configured for live mode.");
  }

  const resolved = await resolveYoutubeLiveChat(credentials);
  liveChatCache = { value: resolved, expiresAt: now + LIVE_CHAT_CACHE_TTL_MS };
  return resolved;
}

async function getNextPendingMessage(client: PoolClient): Promise<PendingYoutubeChatMessage | null> {
  const result = await client.query<PendingYoutubeChatMessage>(
    `
      SELECT id, message_text, message_kind, enqueued_at_utc, attempts
      FROM youtube_chat_messages
      WHERE status = 'pending'
      ORDER BY
        CASE message_kind
          WHEN 'new_event' THEN 0
          WHEN 'manual_test' THEN 1
          WHEN 'promotional_like' THEN 2
          ELSE 3
        END ASC,
        enqueued_at_utc ASC,
        id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `
  );
  return result.rows[0] ?? null;
}

async function getLastPostedAtUtc(client: PoolClient): Promise<Date | null> {
  const result = await client.query<{ posted_at_utc: Date | null }>(
    `
      SELECT posted_at_utc
      FROM youtube_chat_messages
      WHERE status = 'posted' AND posted_at_utc IS NOT NULL
      ORDER BY posted_at_utc DESC, id DESC
      LIMIT 1
    `
  );
  return result.rows[0]?.posted_at_utc ?? null;
}

async function markPosted(
  client: PoolClient,
  messageId: number,
  resolved: Pick<ResolvedYoutubeLiveChat, "activeBroadcastId" | "liveChatId">,
  youtubeMessageId: string | null,
  mode: "dry-run" | "live"
): Promise<void> {
  await client.query(
    `
      UPDATE youtube_chat_messages
      SET
        status = 'posted',
        attempts = attempts + 1,
        posted_at_utc = NOW(),
        last_attempt_at_utc = NOW(),
        youtube_broadcast_id = $2,
        youtube_live_chat_id = $3,
        youtube_message_id = $4,
        payload_json = payload_json || $5::jsonb
      WHERE id = $1
    `,
    [
      messageId,
      resolved.activeBroadcastId ?? null,
      resolved.liveChatId ?? null,
      youtubeMessageId,
      JSON.stringify({ publishMode: mode, publishedAtUtc: new Date().toISOString() })
    ]
  );
}

async function markSkipped(
  client: PoolClient,
  messageId: number,
  reason: "stale_queue" | "chat_disabled" | "rate_limited",
  details: Record<string, unknown> = {}
): Promise<void> {
  await client.query(
    `
      UPDATE youtube_chat_messages
      SET
        status = 'skipped',
        skip_reason = $2,
        attempts = attempts + 1,
        last_attempt_at_utc = NOW(),
        payload_json = payload_json || $3::jsonb
      WHERE id = $1
    `,
    [messageId, reason, JSON.stringify(details)]
  );
}

async function markFailed(
  client: PoolClient,
  messageId: number,
  details: Record<string, unknown> = {}
): Promise<void> {
  await client.query(
    `
      UPDATE youtube_chat_messages
      SET
        status = 'failed',
        skip_reason = 'api_error',
        attempts = attempts + 1,
        last_attempt_at_utc = NOW(),
        payload_json = payload_json || $2::jsonb
      WHERE id = $1
    `,
    [messageId, JSON.stringify(details)]
  );
}

function classifyPublishError(error: unknown): PublishErrorOutcome {
  if (error instanceof YoutubeApiError) {
    if (error.reason && RATE_LIMIT_REASONS.has(error.reason)) {
      return {
        status: "skipped",
        reason: "rate_limited",
        invalidateCache: false,
        message: error.message
      };
    }

    if (
      (error.reason && CHAT_DISABLED_REASONS.has(error.reason)) ||
      (error.status === 404 && !error.reason) ||
      error.reason === "chat_disabled"
    ) {
      return {
        status: "skipped",
        reason: "chat_disabled",
        invalidateCache: true,
        message: error.message
      };
    }
  }

  return {
    status: "failed",
    reason: "api_error",
    invalidateCache: true,
    message: error instanceof Error ? error.message : "Unknown YouTube chat publishing error"
  };
}

export async function runYoutubeChatPublisherCycle(): Promise<YoutubeChatPublisherSummary> {
  if (!env.youtubeChatEnabled) {
    return { status: "idle", reason: "disabled", messageId: null };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await enqueuePromotionalLikeYoutubeChatMessage(client);
    const pending = await getNextPendingMessage(client);
    if (!pending) {
      await client.query("COMMIT");
      return { status: "idle", reason: "no_pending", messageId: null };
    }

    const queueAgeMs = Date.now() - pending.enqueued_at_utc.getTime();
    if (queueAgeMs > env.youtubeChatStaleQueueMs) {
      await markSkipped(client, pending.id, "stale_queue", {
        queueAgeMs,
        messageKind: pending.message_kind
      });
      await client.query("COMMIT");
      return { status: "skipped", reason: "stale_queue", messageId: pending.id };
    }

    const lastPostedAtUtc = await getLastPostedAtUtc(client);
    if (lastPostedAtUtc && Date.now() - lastPostedAtUtc.getTime() < env.youtubeChatMinIntervalMs) {
      await client.query("COMMIT");
      return { status: "blocked", reason: "cooldown", messageId: pending.id };
    }

    if (env.youtubeChatMode === "dry-run") {
      await markPosted(client, pending.id, { activeBroadcastId: null, liveChatId: null }, null, "dry-run");
      await client.query("COMMIT");
      return { status: "posted", reason: "dry_run", messageId: pending.id, youtubeMessageId: null };
    }

    try {
      const resolved = await resolveCachedLiveChat();
      if (!resolved.activeBroadcastId) {
        await client.query("COMMIT");
        return { status: "blocked", reason: "no_active_broadcast", messageId: pending.id };
      }

      if (!resolved.liveChatId) {
        invalidateLiveChatCache();
        await markSkipped(client, pending.id, "chat_disabled", {
          reason: "missing_live_chat_id",
          activeBroadcastId: resolved.activeBroadcastId
        });
        await client.query("COMMIT");
        return { status: "skipped", reason: "chat_disabled", messageId: pending.id };
      }

      const inserted = await insertYoutubeLiveChatMessage(resolved, pending.message_text);
      await markPosted(client, pending.id, resolved, inserted.messageId, "live");
      await client.query("COMMIT");
      return {
        status: "posted",
        reason: "published",
        messageId: pending.id,
        youtubeMessageId: inserted.messageId
      };
    } catch (error) {
      const outcome = classifyPublishError(error);
      if (outcome.invalidateCache) invalidateLiveChatCache();

      if (outcome.status === "skipped") {
        await markSkipped(client, pending.id, outcome.reason, {
          error: outcome.message,
          attemptsBefore: pending.attempts
        });
      } else {
        await markFailed(client, pending.id, {
          error: outcome.message,
          attemptsBefore: pending.attempts
        });
      }

      await client.query("COMMIT");
      return { status: outcome.status, reason: outcome.reason, messageId: pending.id };
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
