import { type SeismicEvent, type YoutubeChatMessageKind } from "@sismica/shared";
import { type PoolClient } from "pg";

import { env } from "../config/env.js";
import {
  buildNewEventYoutubeChatMessage,
  isEventFreshForYoutubeChat
} from "./youtubeChatMessageFormatter.js";
import { buildPromotionalLikeYoutubeChatMessage } from "./youtubeChatPromotionalService.js";

const PROMOTIONAL_BOOT_AT_MS = Date.now();

async function getPendingCount(client: PoolClient): Promise<number> {
  const result = await client.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM youtube_chat_messages WHERE status = 'pending'`
  );
  return result.rows[0]?.total ?? 0;
}

async function hasPendingMessageKinds(
  client: PoolClient,
  kinds: readonly YoutubeChatMessageKind[]
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM youtube_chat_messages
        WHERE status = 'pending'
          AND message_kind = ANY($1::text[])
      ) AS exists
    `,
    [kinds]
  );
  return result.rows[0]?.exists ?? false;
}

async function trimPendingQueue(client: PoolClient): Promise<void> {
  const pending = await getPendingCount(client);
  if (pending < env.youtubeChatMaxQueueSize) return;

  const overflow = pending - env.youtubeChatMaxQueueSize + 1;
  await client.query(
    `
      WITH oldest AS (
        SELECT id
        FROM youtube_chat_messages
        WHERE status = 'pending'
        ORDER BY
          CASE message_kind
            WHEN 'promotional_like' THEN 0
            WHEN 'manual_test' THEN 1
            ELSE 2
          END ASC,
          enqueued_at_utc ASC,
          id ASC
        LIMIT $1
      )
      UPDATE youtube_chat_messages
      SET
        status = 'skipped',
        skip_reason = 'queue_overflow',
        last_attempt_at_utc = NOW(),
        payload_json = payload_json || jsonb_build_object('queueOverflowAtUtc', NOW())
      WHERE id IN (SELECT id FROM oldest)
    `,
    [overflow]
  );
}

async function insertSkippedEvent(
  client: PoolClient,
  event: SeismicEvent,
  reason: "stale_event" | "manual_off",
  messageText: string
): Promise<void> {
  await client.query(
    `
      INSERT INTO youtube_chat_messages (
        canonical_event_id,
        provider_event_id,
        message_text,
        message_kind,
        status,
        skip_reason,
        event_time_utc,
        first_seen_at_utc,
        payload_json
      ) VALUES ($1, $2, $3, 'new_event', 'skipped', $4, $5, NOW(), $6::jsonb)
      ON CONFLICT (canonical_event_id)
      WHERE message_kind = 'new_event' AND canonical_event_id IS NOT NULL
      DO NOTHING
    `,
    [
      event.eventId,
      event.sourceEventId,
      messageText,
      reason,
      event.eventTimeUtc,
      JSON.stringify({
        source: event.source,
        title: event.title,
        magnitude: event.magnitude,
        depthKm: event.depthKm
      })
    ]
  );
}

type PromotionalState = {
  lastActivityAtUtc: Date | null;
  lastVariantIndex: number | null;
};

async function loadPromotionalState(client: PoolClient): Promise<PromotionalState> {
  const result = await client.query<{ last_activity_at_utc: Date | null; last_variant_index: number | null }>(
    `
      SELECT
        MAX(COALESCE(posted_at_utc, enqueued_at_utc)) AS last_activity_at_utc,
        (
          SELECT NULLIF(payload_json->>'variantIndex', '')::int
          FROM youtube_chat_messages
          WHERE message_kind = 'promotional_like'
          ORDER BY COALESCE(posted_at_utc, enqueued_at_utc) DESC, id DESC
          LIMIT 1
        ) AS last_variant_index
      FROM youtube_chat_messages
      WHERE message_kind = 'promotional_like'
    `
  );
  return {
    lastActivityAtUtc: result.rows[0]?.last_activity_at_utc ?? null,
    lastVariantIndex: result.rows[0]?.last_variant_index ?? null
  };
}

export async function enqueueNewEventYoutubeChatMessage(
  client: PoolClient,
  event: SeismicEvent
): Promise<void> {
  if (!env.youtubeChatEnabled) return;

  const messageText = buildNewEventYoutubeChatMessage(event);

  if (env.youtubeChatMode === "off") {
    await insertSkippedEvent(client, event, "manual_off", messageText);
    return;
  }

  if (!isEventFreshForYoutubeChat(event, Date.now(), env.youtubeChatMaxEventAgeMinutes)) {
    await insertSkippedEvent(client, event, "stale_event", messageText);
    return;
  }

  await trimPendingQueue(client);

  await client.query(
    `
      INSERT INTO youtube_chat_messages (
        canonical_event_id,
        provider_event_id,
        message_text,
        message_kind,
        status,
        event_time_utc,
        first_seen_at_utc,
        payload_json
      ) VALUES ($1, $2, $3, 'new_event', 'pending', $4, NOW(), $5::jsonb)
      ON CONFLICT (canonical_event_id)
      WHERE message_kind = 'new_event' AND canonical_event_id IS NOT NULL
      DO NOTHING
    `,
    [
      event.eventId,
      event.sourceEventId,
      messageText,
      event.eventTimeUtc,
      JSON.stringify({
        eventId: event.eventId,
        source: event.source,
        title: event.title,
        magnitude: event.magnitude,
        depthKm: event.depthKm
      })
    ]
  );
}

export async function enqueuePromotionalLikeYoutubeChatMessage(client: PoolClient): Promise<boolean> {
  if (!env.youtubeChatEnabled || !env.youtubeChatPromotionalEnabled || env.youtubeChatMode === "off") {
    return false;
  }

  if (await hasPendingMessageKinds(client, ["new_event", "manual_test"] as const)) {
    return false;
  }

  if (await hasPendingMessageKinds(client, ["promotional_like"] as const)) {
    return false;
  }

  if ((await getPendingCount(client)) >= env.youtubeChatMaxQueueSize) {
    return false;
  }

  const promotionalState = await loadPromotionalState(client);
  const now = Date.now();

  if (!promotionalState.lastActivityAtUtc) {
    if (now - PROMOTIONAL_BOOT_AT_MS < env.youtubeChatPromotionalMinIntervalMs) {
      return false;
    }
  } else if (now - promotionalState.lastActivityAtUtc.getTime() < env.youtubeChatPromotionalMinIntervalMs) {
    return false;
  }

  const promotional = buildPromotionalLikeYoutubeChatMessage(promotionalState.lastVariantIndex);

  await client.query(
    `
      INSERT INTO youtube_chat_messages (
        canonical_event_id,
        provider_event_id,
        message_text,
        message_kind,
        status,
        first_seen_at_utc,
        payload_json
      ) VALUES (
        NULL,
        NULL,
        $1,
        'promotional_like',
        'pending',
        NOW(),
        $2::jsonb
      )
    `,
    [
      promotional.text,
      JSON.stringify({
        source: "promotional_like",
        variantIndex: promotional.variantIndex,
        channel: "SISMICA 24"
      })
    ]
  );

  return true;
}
