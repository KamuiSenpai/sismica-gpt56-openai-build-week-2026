ALTER TABLE ingestion_runs
  ADD COLUMN IF NOT EXISTS associated_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE seismic_events
  ADD COLUMN IF NOT EXISTS mmi DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS cdi DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS intensity_text TEXT,
  ADD COLUMN IF NOT EXISTS station_count INTEGER,
  ADD COLUMN IF NOT EXISTS azimuthal_gap_deg DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS nearest_station_deg DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS rms_sec DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS significance INTEGER,
  ADD COLUMN IF NOT EXISTS felt_reports INTEGER,
  ADD COLUMN IF NOT EXISTS alert_level TEXT,
  ADD COLUMN IF NOT EXISTS tsunami BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS network_code TEXT,
  ADD COLUMN IF NOT EXISTS provider_event_code TEXT,
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS detail_url TEXT,
  ADD COLUMN IF NOT EXISTS preferred_source_priority INTEGER NOT NULL DEFAULT 0;

UPDATE seismic_events
SET preferred_source_priority = CASE source
  WHEN 'IGP' THEN 100
  WHEN 'FUNVISIS' THEN 100
  WHEN 'USGS' THEN 80
  WHEN 'EMSC' THEN 70
  ELSE 0
END
WHERE preferred_source_priority = 0;

CREATE TABLE IF NOT EXISTS event_source_refs (
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES seismic_events(event_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  magnitude DOUBLE PRECISION,
  magnitude_type TEXT,
  depth_km DOUBLE PRECISION,
  intensity_text TEXT,
  event_time_utc TIMESTAMPTZ NOT NULL,
  updated_at_utc TIMESTAMPTZ,
  status TEXT,
  source_url TEXT,
  detail_url TEXT,
  geom GEOGRAPHY(POINT, 4326) NOT NULL,
  raw_payload JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_source_refs_event_id
  ON event_source_refs (event_id);

CREATE INDEX IF NOT EXISTS idx_event_source_refs_event_time
  ON event_source_refs (event_time_utc DESC);

CREATE INDEX IF NOT EXISTS idx_event_source_refs_geom
  ON event_source_refs USING GIST (geom);

INSERT INTO event_source_refs (
  source,
  source_event_id,
  event_id,
  title,
  magnitude,
  magnitude_type,
  depth_km,
  intensity_text,
  event_time_utc,
  updated_at_utc,
  status,
  source_url,
  detail_url,
  geom,
  raw_payload,
  ingested_at
)
SELECT
  source,
  source_event_id,
  event_id,
  title,
  magnitude,
  magnitude_type,
  depth_km,
  intensity_text,
  event_time_utc,
  updated_at_utc,
  status,
  source_url,
  detail_url,
  geom,
  raw_payload,
  ingested_at
FROM seismic_events
ON CONFLICT (source, source_event_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS event_associations (
  association_id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES seismic_events(event_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  time_delta_seconds DOUBLE PRECISION NOT NULL,
  distance_km DOUBLE PRECISION NOT NULL,
  magnitude_delta DOUBLE PRECISION,
  score DOUBLE PRECISION NOT NULL,
  rule_version TEXT NOT NULL DEFAULT 'time60-distance100-mag05-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_event_association_source UNIQUE (source, source_event_id)
);

CREATE TABLE IF NOT EXISTS disaster_contexts (
  context_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_id TEXT REFERENCES seismic_events(event_id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  alert_level TEXT,
  alert_score DOUBLE PRECISION,
  country TEXT,
  event_time_utc TIMESTAMPTZ NOT NULL,
  updated_at_utc TIMESTAMPTZ,
  source_url TEXT,
  geom GEOGRAPHY(POINT, 4326) NOT NULL,
  raw_payload JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_disaster_context_source UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_disaster_contexts_event_time
  ON disaster_contexts (event_time_utc DESC);

CREATE INDEX IF NOT EXISTS idx_disaster_contexts_geom
  ON disaster_contexts USING GIST (geom);

CREATE TABLE IF NOT EXISTS tsunami_products (
  product_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  identifier TEXT NOT NULL,
  center TEXT NOT NULL,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  message_type TEXT NOT NULL,
  urgency TEXT,
  severity TEXT,
  certainty TEXT,
  sent_at_utc TIMESTAMPTZ NOT NULL,
  onset_at_utc TIMESTAMPTZ,
  expires_at_utc TIMESTAMPTZ,
  headline TEXT,
  description TEXT,
  instruction TEXT,
  area_description TEXT,
  source_url TEXT,
  raw_payload TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tsunami_product_source UNIQUE (source, identifier)
);

CREATE INDEX IF NOT EXISTS idx_tsunami_products_sent
  ON tsunami_products (sent_at_utc DESC);
