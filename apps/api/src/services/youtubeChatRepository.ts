import {
  hasYoutubeChatCredentials,
  resolveYoutubeLiveChat,
  type YoutubeChatMessageKind,
  type YoutubeChatMessageStatus,
  type YoutubeChatMode,
  type YoutubeChatSkipReason
} from "@sismica/shared";
import { type Pool } from "pg";

import { env } from "../config/env.js";

type YoutubeChatStatusRow = {
  queue_depth: number;
  last_posted_at_utc: Date | null;
};

type YoutubeChatMessageRow = {
  id: number;
  canonical_event_id: string | null;
  provider_event_id: string | null;
  message_text: string;
  message_kind: YoutubeChatMessageKind;
  status: YoutubeChatMessageStatus;
  skip_reason: YoutubeChatSkipReason | null;
  attempts: number;
  event_time_utc: Date | null;
  first_seen_at_utc: Date | null;
  enqueued_at_utc: Date;
  posted_at_utc: Date | null;
  youtube_broadcast_id: string | null;
  youtube_live_chat_id: string | null;
  youtube_message_id: string | null;
};

export type YoutubeChatStatusView = {
  enabled: boolean;
  mode: YoutubeChatMode;
  promotionalEnabled: boolean;
  promotionalMinIntervalMs: number;
  credentialsConfigured: boolean;
  connected: boolean;
  channelId: string | null;
  activeBroadcastId: string | null;
  liveChatId: string | null;
  queueDepth: number;
  lastPostedAtUtc: string | null;
  error: string | null;
};

export type YoutubeChatMessageView = {
  id: number;
  canonicalEventId: string | null;
  providerEventId: string | null;
  messageText: string;
  messageKind: YoutubeChatMessageKind;
  status: YoutubeChatMessageStatus;
  skipReason: YoutubeChatSkipReason | null;
  attempts: number;
  eventTimeUtc: string | null;
  firstSeenAtUtc: string | null;
  enqueuedAtUtc: string;
  postedAtUtc: string | null;
  youtubeBroadcastId: string | null;
  youtubeLiveChatId: string | null;
  youtubeMessageId: string | null;
};

function toMessageView(row: YoutubeChatMessageRow): YoutubeChatMessageView {
  return {
    id: row.id,
    canonicalEventId: row.canonical_event_id,
    providerEventId: row.provider_event_id,
    messageText: row.message_text,
    messageKind: row.message_kind,
    status: row.status,
    skipReason: row.skip_reason,
    attempts: row.attempts,
    eventTimeUtc: row.event_time_utc?.toISOString() ?? null,
    firstSeenAtUtc: row.first_seen_at_utc?.toISOString() ?? null,
    enqueuedAtUtc: row.enqueued_at_utc.toISOString(),
    postedAtUtc: row.posted_at_utc?.toISOString() ?? null,
    youtubeBroadcastId: row.youtube_broadcast_id,
    youtubeLiveChatId: row.youtube_live_chat_id,
    youtubeMessageId: row.youtube_message_id
  };
}

export async function getYoutubeChatStatus(pool: Pool): Promise<YoutubeChatStatusView> {
  const stats = await pool.query<YoutubeChatStatusRow>(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS queue_depth,
        MAX(posted_at_utc) AS last_posted_at_utc
      FROM youtube_chat_messages
    `
  );

  const credentials = {
    clientId: env.youtubeChatClientId ?? "",
    clientSecret: env.youtubeChatClientSecret ?? "",
    refreshToken: env.youtubeChatRefreshToken ?? "",
    channelId: env.youtubeChatChannelId ?? null
  };
  const credentialsConfigured = hasYoutubeChatCredentials(credentials);
  const row = stats.rows[0];

  let connected = false;
  let activeBroadcastId: string | null = null;
  let liveChatId: string | null = null;
  let error: string | null = null;
  let channelId = env.youtubeChatChannelId ?? null;

  if (env.youtubeChatEnabled && credentialsConfigured) {
    try {
      const resolved = await resolveYoutubeLiveChat(credentials);
      connected = Boolean(resolved.liveChatId);
      activeBroadcastId = resolved.activeBroadcastId;
      liveChatId = resolved.liveChatId;
      channelId = resolved.channelId ?? channelId;
    } catch (caughtError) {
      error = caughtError instanceof Error ? caughtError.message : "Unable to resolve active YouTube chat";
    }
  } else if (env.youtubeChatEnabled && !credentialsConfigured && env.youtubeChatMode === "live") {
    error = "YouTube chat credentials are not configured.";
  }

  return {
    enabled: env.youtubeChatEnabled,
    mode: env.youtubeChatMode,
    promotionalEnabled: env.youtubeChatPromotionalEnabled,
    promotionalMinIntervalMs: env.youtubeChatPromotionalMinIntervalMs,
    credentialsConfigured,
    connected,
    channelId,
    activeBroadcastId,
    liveChatId,
    queueDepth: row?.queue_depth ?? 0,
    lastPostedAtUtc: row?.last_posted_at_utc?.toISOString() ?? null,
    error
  };
}

export async function getYoutubeChatMessages(pool: Pool, limit: number): Promise<YoutubeChatMessageView[]> {
  const result = await pool.query<YoutubeChatMessageRow>(
    `
      SELECT
        id,
        canonical_event_id,
        provider_event_id,
        message_text,
        message_kind,
        status,
        skip_reason,
        attempts,
        event_time_utc,
        first_seen_at_utc,
        enqueued_at_utc,
        posted_at_utc,
        youtube_broadcast_id,
        youtube_live_chat_id,
        youtube_message_id
      FROM youtube_chat_messages
      ORDER BY id DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map(toMessageView);
}

export async function enqueueYoutubeChatTestMessage(
  pool: Pool,
  text: string
): Promise<YoutubeChatMessageView> {
  const trimmedText = text.trim();
  const status: YoutubeChatMessageStatus = env.youtubeChatMode === "off" ? "skipped" : "pending";
  const skipReason: YoutubeChatSkipReason | null = env.youtubeChatMode === "off" ? "manual_off" : null;

  const result = await pool.query<YoutubeChatMessageRow>(
    `
      INSERT INTO youtube_chat_messages (
        canonical_event_id,
        provider_event_id,
        message_text,
        message_kind,
        status,
        skip_reason,
        first_seen_at_utc,
        payload_json
      ) VALUES (
        NULL,
        NULL,
        $1,
        'manual_test',
        $2,
        $3,
        NOW(),
        $4::jsonb
      )
      RETURNING
        id,
        canonical_event_id,
        provider_event_id,
        message_text,
        message_kind,
        status,
        skip_reason,
        attempts,
        event_time_utc,
        first_seen_at_utc,
        enqueued_at_utc,
        posted_at_utc,
        youtube_broadcast_id,
        youtube_live_chat_id,
        youtube_message_id
    `,
    [
      trimmedText,
      status,
      skipReason,
      JSON.stringify({ source: "api_test", requestedMode: env.youtubeChatMode })
    ]
  );

  return toMessageView(result.rows[0]);
}
