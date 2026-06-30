CREATE TABLE IF NOT EXISTS seismic_events (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  magnitude DOUBLE PRECISION,
  magnitude_type TEXT,
  depth_km DOUBLE PRECISION,
  event_time_utc TIMESTAMPTZ NOT NULL,
  updated_at_utc TIMESTAMPTZ,
  status TEXT,
  source_url TEXT,
  geom GEOGRAPHY(POINT, 4326) NOT NULL,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_seismic_events_source_event UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_seismic_events_event_time_utc
  ON seismic_events (event_time_utc DESC);

CREATE INDEX IF NOT EXISTS idx_seismic_events_magnitude
  ON seismic_events (magnitude DESC);

CREATE INDEX IF NOT EXISTS idx_seismic_events_geom
  ON seismic_events USING GIST (geom);
