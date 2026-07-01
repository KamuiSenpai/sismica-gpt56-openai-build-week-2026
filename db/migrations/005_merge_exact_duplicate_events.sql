BEGIN;

CREATE TEMP TABLE exact_event_merges ON COMMIT DROP AS
WITH duplicate_keys AS (
  SELECT
    event_time_utc,
    ST_AsEWKB(geom::geometry) AS geom_key,
    magnitude
  FROM seismic_events
  GROUP BY event_time_utc, ST_AsEWKB(geom::geometry), magnitude
  HAVING COUNT(*) > 1
),
candidates AS (
  SELECT
    event.event_id,
    event.event_time_utc,
    ST_AsEWKB(event.geom::geometry) AS geom_key,
    event.magnitude,
    event.preferred_source_priority,
    COUNT(reference.source)::integer AS source_count
  FROM seismic_events event
  JOIN duplicate_keys duplicate
    ON duplicate.event_time_utc = event.event_time_utc
    AND duplicate.geom_key = ST_AsEWKB(event.geom::geometry)
    AND duplicate.magnitude IS NOT DISTINCT FROM event.magnitude
  LEFT JOIN event_source_refs reference ON reference.event_id = event.event_id
  GROUP BY
    event.event_id,
    event.event_time_utc,
    ST_AsEWKB(event.geom::geometry),
    event.magnitude,
    event.preferred_source_priority
),
ranked AS (
  SELECT
    event_id,
    FIRST_VALUE(event_id) OVER (
      PARTITION BY event_time_utc, geom_key, magnitude
      ORDER BY source_count DESC, preferred_source_priority DESC, event_id ASC
    ) AS survivor_event_id,
    ROW_NUMBER() OVER (
      PARTITION BY event_time_utc, geom_key, magnitude
      ORDER BY source_count DESC, preferred_source_priority DESC, event_id ASC
    ) AS duplicate_rank
  FROM candidates
)
SELECT
  event_id AS duplicate_event_id,
  survivor_event_id
FROM ranked
WHERE duplicate_rank > 1;

ALTER TABLE exact_event_merges ADD PRIMARY KEY (duplicate_event_id);

UPDATE event_source_refs reference
SET event_id = merge.survivor_event_id
FROM exact_event_merges merge
WHERE reference.event_id = merge.duplicate_event_id;

UPDATE event_associations association
SET event_id = merge.survivor_event_id
FROM exact_event_merges merge
WHERE association.event_id = merge.duplicate_event_id;

UPDATE disaster_contexts context
SET event_id = merge.survivor_event_id
FROM exact_event_merges merge
WHERE context.event_id = merge.duplicate_event_id;

DELETE FROM seismic_events event
USING exact_event_merges merge
WHERE event.event_id = merge.duplicate_event_id;

COMMIT;
