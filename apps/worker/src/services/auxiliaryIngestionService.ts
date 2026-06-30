import { type DisasterContext, type TsunamiProduct } from "@sismica/shared";
import { type PoolClient } from "pg";

type AuxiliaryRecord<T> = { item: T; rawPayload: unknown };

export type AuxiliaryIngestionStats = {
  inserted: number;
  updated: number;
  associated: number;
};

async function findEventForContext(client: PoolClient, context: DisasterContext): Promise<string | null> {
  const result = await client.query<{ event_id: string }>(
    `
      SELECT event_id
      FROM seismic_events
      WHERE event_time_utc BETWEEN $1::timestamptz - INTERVAL '10 minutes'
        AND $1::timestamptz + INTERVAL '10 minutes'
        AND ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
          150000
        )
      ORDER BY
        ABS(EXTRACT(EPOCH FROM (event_time_utc - $1::timestamptz)))
        + ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) / 1000.0
      LIMIT 1
    `,
    [context.eventTimeUtc, context.longitude, context.latitude]
  );
  return result.rows[0]?.event_id ?? null;
}

export async function ingestDisasterContexts(
  client: PoolClient,
  records: Array<AuxiliaryRecord<DisasterContext>>
): Promise<AuxiliaryIngestionStats> {
  const stats: AuxiliaryIngestionStats = { inserted: 0, updated: 0, associated: 0 };

  for (const record of records) {
    const context = record.item;
    const existing = await client.query<{ event_id: string | null; unchanged: boolean }>(
      `SELECT event_id, raw_payload = $2::jsonb AS unchanged FROM disaster_contexts WHERE context_id = $1`,
      [context.contextId, JSON.stringify(record.rawPayload)]
    );
    const eventId = existing.rows[0]?.event_id ?? await findEventForContext(client, context);
    if (existing.rows[0]?.unchanged && existing.rows[0].event_id === eventId) {
      continue;
    }
    await client.query(
      `
        INSERT INTO disaster_contexts (
          context_id, source, source_event_id, event_id, title, alert_level,
          alert_score, country, event_time_utc, updated_at_utc, source_url,
          geom, raw_payload, ingested_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          ST_SetSRID(ST_MakePoint($12, $13), 4326)::geography,
          $14::jsonb, NOW()
        )
        ON CONFLICT (context_id) DO UPDATE SET
          event_id = COALESCE(disaster_contexts.event_id, EXCLUDED.event_id),
          title = EXCLUDED.title,
          alert_level = EXCLUDED.alert_level,
          alert_score = EXCLUDED.alert_score,
          country = EXCLUDED.country,
          event_time_utc = EXCLUDED.event_time_utc,
          updated_at_utc = EXCLUDED.updated_at_utc,
          source_url = EXCLUDED.source_url,
          geom = EXCLUDED.geom,
          raw_payload = EXCLUDED.raw_payload,
          ingested_at = NOW()
      `,
      [
        context.contextId,
        context.source,
        context.sourceEventId,
        eventId,
        context.title,
        context.alertLevel,
        context.alertScore,
        context.country,
        context.eventTimeUtc,
        context.updatedAtUtc,
        context.sourceUrl,
        context.longitude,
        context.latitude,
        JSON.stringify(record.rawPayload)
      ]
    );
    if (existing.rowCount) stats.updated += 1;
    else stats.inserted += 1;
    if (!existing.rows[0]?.event_id && eventId) stats.associated += 1;
  }

  return stats;
}

export async function ingestTsunamiProducts(
  client: PoolClient,
  records: Array<AuxiliaryRecord<TsunamiProduct>>
): Promise<AuxiliaryIngestionStats> {
  const stats: AuxiliaryIngestionStats = { inserted: 0, updated: 0, associated: 0 };

  for (const record of records) {
    const product = record.item;
    const existing = await client.query<{ unchanged: boolean }>(
      `SELECT raw_payload = $2 AS unchanged FROM tsunami_products WHERE product_id = $1`,
      [product.productId, String(record.rawPayload)]
    );
    if (existing.rows[0]?.unchanged) {
      continue;
    }
    await client.query(
      `
        INSERT INTO tsunami_products (
          product_id, source, identifier, center, event, status, message_type,
          urgency, severity, certainty, sent_at_utc, onset_at_utc,
          expires_at_utc, headline, description, instruction,
          area_description, source_url, raw_payload, ingested_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, NOW()
        )
        ON CONFLICT (product_id) DO UPDATE SET
          center = EXCLUDED.center,
          event = EXCLUDED.event,
          status = EXCLUDED.status,
          message_type = EXCLUDED.message_type,
          urgency = EXCLUDED.urgency,
          severity = EXCLUDED.severity,
          certainty = EXCLUDED.certainty,
          sent_at_utc = EXCLUDED.sent_at_utc,
          onset_at_utc = EXCLUDED.onset_at_utc,
          expires_at_utc = EXCLUDED.expires_at_utc,
          headline = EXCLUDED.headline,
          description = EXCLUDED.description,
          instruction = EXCLUDED.instruction,
          area_description = EXCLUDED.area_description,
          source_url = EXCLUDED.source_url,
          raw_payload = EXCLUDED.raw_payload,
          ingested_at = NOW()
      `,
      [
        product.productId,
        product.source,
        product.identifier,
        product.center,
        product.event,
        product.status,
        product.messageType,
        product.urgency,
        product.severity,
        product.certainty,
        product.sentAtUtc,
        product.onsetAtUtc,
        product.expiresAtUtc,
        product.headline,
        product.description,
        product.instruction,
        product.areaDescription,
        product.sourceUrl,
        String(record.rawPayload)
      ]
    );
    if (existing.rowCount) stats.updated += 1;
    else stats.inserted += 1;
  }

  return stats;
}
