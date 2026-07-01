CREATE TABLE IF NOT EXISTS seismic_stations (
  station_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  network_code TEXT NOT NULL,
  station_code TEXT NOT NULL,
  site_name TEXT,
  country_code TEXT,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  elevation_m DOUBLE PRECISION,
  start_time_utc TIMESTAMPTZ,
  end_time_utc TIMESTAMPTZ,
  source_url TEXT NOT NULL,
  geom GEOGRAPHY(POINT, 4326) NOT NULL,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_seismic_station_code UNIQUE (source, network_code, station_code)
);

CREATE INDEX IF NOT EXISTS idx_seismic_stations_geom
  ON seismic_stations USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_seismic_stations_metadata_updated
  ON seismic_stations (metadata_updated_at DESC);

CREATE TABLE IF NOT EXISTS station_states (
  station_id TEXT PRIMARY KEY REFERENCES seismic_stations(station_id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  status TEXT NOT NULL CHECK (status IN ('online', 'delayed', 'triggered', 'offline', 'unknown')),
  phase TEXT CHECK (phase IS NULL OR phase IN ('P', 'S', 'UNKNOWN')),
  observed_at_utc TIMESTAMPTZ NOT NULL,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  trigger_value DOUBLE PRECISION,
  engine TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_station_states_observed
  ON station_states (observed_at_utc DESC);

CREATE TABLE IF NOT EXISTS seismic_picks (
  pick_id TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  station_id TEXT NOT NULL REFERENCES seismic_stations(station_id) ON DELETE RESTRICT,
  phase TEXT NOT NULL CHECK (phase IN ('P', 'S', 'UNKNOWN')),
  pick_time_utc TIMESTAMPTZ NOT NULL,
  snr DOUBLE PRECISION CHECK (snr IS NULL OR snr >= 0),
  amplitude DOUBLE PRECISION,
  algorithm TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_seismic_pick_engine UNIQUE (engine, station_id, pick_time_utc, phase)
);

CREATE INDEX IF NOT EXISTS idx_seismic_picks_time
  ON seismic_picks (pick_time_utc DESC);

CREATE TABLE IF NOT EXISTS experimental_origins (
  origin_id TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  origin_time_utc TIMESTAMPTZ NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  depth_km DOUBLE PRECISION NOT NULL CHECK (depth_km BETWEEN 0 AND 800),
  magnitude DOUBLE PRECISION CHECK (magnitude IS NULL OR magnitude BETWEEN -2 AND 10),
  station_count INTEGER NOT NULL CHECK (station_count >= 0),
  rms_sec DOUBLE PRECISION CHECK (rms_sec IS NULL OR rms_sec >= 0),
  azimuthal_gap_deg DOUBLE PRECISION
    CHECK (azimuthal_gap_deg IS NULL OR azimuthal_gap_deg BETWEEN 0 AND 360),
  quality TEXT NOT NULL CHECK (quality IN ('preliminary', 'acceptable', 'rejected')),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'located', 'discarded', 'confirmed')),
  official_event_id TEXT REFERENCES seismic_events(event_id) ON DELETE SET NULL,
  geom GEOGRAPHY(POINT, 4326) NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experimental_origins_time
  ON experimental_origins (origin_time_utc DESC);

CREATE INDEX IF NOT EXISTS idx_experimental_origins_geom
  ON experimental_origins USING GIST (geom);
