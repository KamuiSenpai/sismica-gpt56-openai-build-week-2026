import { type Pool, type PoolClient } from "pg";
import { z } from "zod";

import { env } from "../config/env.js";

const isoTimestamp = z.string().datetime({ offset: true });
const stationStatus = z.enum(["unknown", "online", "delayed", "offline", "triggered"]);
const stationPhase = z.enum(["P", "S", "UNKNOWN"]);

export const stationSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.string().trim().min(1).max(120),
    states: z
      .array(
        z.object({
          stationId: z.string().trim().min(1).max(160),
          status: stationStatus,
          phase: stationPhase.optional(),
          latencyMs: z.number().int().nonnegative().max(86_400_000).optional(),
          triggerValue: z.number().finite().optional(),
          observedAtUtc: isoTimestamp,
          sequence: z.number().int().nonnegative()
        })
      )
      .max(1000),
    picks: z
      .array(
        z.object({
          pickId: z.string().trim().min(1).max(200),
          stationId: z.string().trim().min(1).max(160),
          phase: stationPhase,
          pickTimeUtc: isoTimestamp,
          snr: z.number().finite().nonnegative().optional(),
          amplitude: z.number().finite().optional(),
          algorithm: z.string().trim().min(1).max(120)
        })
      )
      .max(5000)
      .optional()
  })
  .superRefine((snapshot, context) => {
    const futureLimit = Date.now() + 5 * 60_000;
    snapshot.states.forEach((state, index) => {
      if (Date.parse(state.observedAtUtc) > futureLimit) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["states", index, "observedAtUtc"],
          message: "observedAtUtc cannot be more than five minutes in the future"
        });
      }
    });
  });

export const experimentalOriginSchema = z
  .object({
    schemaVersion: z.literal(1),
    originId: z.string().trim().min(1).max(200),
    engine: z.string().trim().min(1).max(120),
    originTimeUtc: isoTimestamp,
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    depthKm: z.number().finite().min(0).max(800),
    magnitude: z.number().finite().min(-2).max(10).optional(),
    stationCount: z.number().int().nonnegative(),
    rmsSec: z.number().finite().nonnegative().optional(),
    azimuthalGapDeg: z.number().finite().min(0).max(360).optional(),
    quality: z.enum(["preliminary", "acceptable", "rejected"]),
    status: z.enum(["candidate", "located", "discarded", "confirmed"]),
    officialEventId: z.string().trim().min(1).max(200).optional()
  })
  .refine((origin) => origin.status !== "located" || origin.stationCount >= 4, {
    message: "located origins require at least four stations",
    path: ["stationCount"]
  });

type StationSnapshot = z.infer<typeof stationSnapshotSchema>;
type ExperimentalOriginInput = z.infer<typeof experimentalOriginSchema>;

async function persistState(client: PoolClient, snapshot: StationSnapshot, index: number) {
  const state = snapshot.states[index];
  const result = await client.query(
    `
      INSERT INTO station_states (
        station_id, sequence, status, phase, latency_ms, trigger_value,
        observed_at_utc, engine, raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (station_id) DO UPDATE SET
        sequence = EXCLUDED.sequence,
        status = EXCLUDED.status,
        phase = EXCLUDED.phase,
        latency_ms = EXCLUDED.latency_ms,
        trigger_value = EXCLUDED.trigger_value,
        observed_at_utc = EXCLUDED.observed_at_utc,
        engine = EXCLUDED.engine,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
      WHERE EXCLUDED.sequence > station_states.sequence
      RETURNING station_id, sequence, status, phase, latency_ms, trigger_value, observed_at_utc, engine
    `,
    [
      state.stationId,
      state.sequence,
      state.status,
      state.phase ?? null,
      state.latencyMs ?? null,
      state.triggerValue ?? null,
      state.observedAtUtc,
      snapshot.engine,
      JSON.stringify(state)
    ]
  );
  return result.rows[0] as
    | {
        station_id: string;
        sequence: string;
        status: string;
        phase: string | null;
        latency_ms: number | null;
        trigger_value: number | null;
        observed_at_utc: Date;
        engine: string;
      }
    | undefined;
}

export async function persistStationSnapshot(database: Pool, snapshot: StationSnapshot) {
  const client = await database.connect();
  let accepted = 0;
  let ignored = 0;
  let picks = 0;
  try {
    await client.query("BEGIN");
    for (let index = 0; index < snapshot.states.length; index += 1) {
      const row = await persistState(client, snapshot, index);
      if (!row) {
        ignored += 1;
        continue;
      }
      accepted += 1;
      await client.query("SELECT pg_notify($1, $2)", [
        env.stationStreamChannel,
        JSON.stringify({
          type: "station.state",
          payload: {
            stationId: row.station_id,
            sequence: Number(row.sequence),
            status: row.status,
            phase: row.phase,
            latencyMs: row.latency_ms,
            triggerValue: row.trigger_value,
            observedAtUtc: row.observed_at_utc.toISOString(),
            engine: row.engine
          }
        })
      ]);
    }

    for (const pick of snapshot.picks ?? []) {
      const result = await client.query(
        `
          INSERT INTO seismic_picks (
            pick_id, engine, station_id, phase, pick_time_utc, snr,
            amplitude, algorithm, raw_payload
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
          ON CONFLICT DO NOTHING
        `,
        [
          pick.pickId,
          snapshot.engine,
          pick.stationId,
          pick.phase,
          pick.pickTimeUtc,
          pick.snr ?? null,
          pick.amplitude ?? null,
          pick.algorithm,
          JSON.stringify(pick)
        ]
      );
      picks += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { accepted, ignored, picks };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function persistExperimentalOrigin(database: Pool, origin: ExperimentalOriginInput) {
  const result = await database.query(
    `
      INSERT INTO experimental_origins (
        origin_id, engine, origin_time_utc, latitude, longitude, depth_km,
        magnitude, station_count, rms_sec, azimuthal_gap_deg, quality, status,
        official_event_id, geom, raw_payload
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $14::jsonb
      )
      ON CONFLICT (origin_id) DO UPDATE SET
        origin_time_utc = EXCLUDED.origin_time_utc,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        depth_km = EXCLUDED.depth_km,
        magnitude = EXCLUDED.magnitude,
        station_count = EXCLUDED.station_count,
        rms_sec = EXCLUDED.rms_sec,
        azimuthal_gap_deg = EXCLUDED.azimuthal_gap_deg,
        quality = EXCLUDED.quality,
        status = EXCLUDED.status,
        official_event_id = EXCLUDED.official_event_id,
        geom = EXCLUDED.geom,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `,
    [
      origin.originId,
      origin.engine,
      origin.originTimeUtc,
      origin.latitude,
      origin.longitude,
      origin.depthKm,
      origin.magnitude ?? null,
      origin.stationCount,
      origin.rmsSec ?? null,
      origin.azimuthalGapDeg ?? null,
      origin.quality,
      origin.status,
      origin.officialEventId ?? null,
      JSON.stringify(origin)
    ]
  );
  return { inserted: Boolean(result.rows[0]?.inserted), originId: origin.originId };
}
