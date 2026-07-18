BEGIN;

CREATE TABLE IF NOT EXISTS openai_event_explanation_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES seismic_events(event_id) ON DELETE CASCADE,
  event_version_utc TIMESTAMPTZ NOT NULL,
  requested_model TEXT NOT NULL,
  response_model TEXT,
  response_id TEXT,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  request_id TEXT NOT NULL,
  requested_at_utc TIMESTAMPTZ NOT NULL,
  completed_at_utc TIMESTAMPTZ NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
  result_json JSONB,
  error_code TEXT,
  provider_status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'completed' AND response_id IS NOT NULL AND result_json IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND result_json IS NULL AND error_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_openai_event_explanation_completed
  ON openai_event_explanation_audit (event_id, event_version_utc, requested_model, input_sha256)
  WHERE status = 'completed';

CREATE UNIQUE INDEX IF NOT EXISTS uq_openai_event_explanation_response_id
  ON openai_event_explanation_audit (response_id)
  WHERE response_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_openai_event_explanation_recent
  ON openai_event_explanation_audit (requested_at_utc DESC);

CREATE TABLE IF NOT EXISTS seismic_presence_materialized (
  cache_key TEXT PRIMARY KEY CHECK (cache_key = 'global'),
  generated_at TIMESTAMPTZ NOT NULL,
  source_max_ingested_at TIMESTAMPTZ,
  summary JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
