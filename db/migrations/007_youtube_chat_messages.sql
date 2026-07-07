CREATE TABLE IF NOT EXISTS youtube_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  canonical_event_id TEXT,
  provider_event_id TEXT,
  message_text TEXT NOT NULL,
  message_kind TEXT NOT NULL CHECK (message_kind IN ('new_event', 'manual_test')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'skipped', 'failed')),
  skip_reason TEXT CHECK (
    skip_reason IS NULL
    OR skip_reason IN (
      'duplicate_event',
      'stale_event',
      'stale_queue',
      'no_active_broadcast',
      'chat_disabled',
      'rate_limited',
      'queue_overflow',
      'manual_off',
      'api_error'
    )
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  event_time_utc TIMESTAMPTZ,
  first_seen_at_utc TIMESTAMPTZ,
  enqueued_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at_utc TIMESTAMPTZ,
  last_attempt_at_utc TIMESTAMPTZ,
  youtube_broadcast_id TEXT,
  youtube_live_chat_id TEXT,
  youtube_message_id TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_youtube_chat_new_event_canonical
  ON youtube_chat_messages (canonical_event_id)
  WHERE message_kind = 'new_event' AND canonical_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_youtube_chat_messages_pending
  ON youtube_chat_messages (status, enqueued_at_utc ASC);

CREATE INDEX IF NOT EXISTS idx_youtube_chat_messages_posted
  ON youtube_chat_messages (posted_at_utc DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS idx_youtube_chat_messages_event_time
  ON youtube_chat_messages (event_time_utc DESC NULLS LAST);
