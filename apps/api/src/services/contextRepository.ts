import { type DisasterContext, type TsunamiProduct } from "@sismica/shared";
import { type Pool } from "pg";

export async function getActiveDisasters(pool: Pool): Promise<DisasterContext[]> {
  const result = await pool.query<{
    context_id: string;
    source_event_id: string;
    event_id: string | null;
    title: string;
    alert_level: string | null;
    alert_score: number | null;
    country: string | null;
    latitude: number;
    longitude: number;
    event_time_utc: Date;
    updated_at_utc: Date | null;
    source_url: string | null;
  }>(
    `
      SELECT
        context_id,
        source_event_id,
        event_id,
        title,
        alert_level,
        alert_score,
        country,
        ST_Y(geom::geometry) AS latitude,
        ST_X(geom::geometry) AS longitude,
        event_time_utc,
        updated_at_utc,
        source_url
      FROM disaster_contexts
      WHERE event_time_utc >= NOW() - INTERVAL '7 days'
      ORDER BY alert_score DESC NULLS LAST, event_time_utc DESC
      LIMIT 100
    `
  );
  return result.rows.map((row) => ({
    contextId: row.context_id,
    source: "GDACS",
    sourceEventId: row.source_event_id,
    eventId: row.event_id,
    title: row.title,
    alertLevel: row.alert_level,
    alertScore: row.alert_score,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    eventTimeUtc: row.event_time_utc.toISOString(),
    updatedAtUtc: row.updated_at_utc?.toISOString() ?? null,
    sourceUrl: row.source_url
  }));
}

export async function getActiveTsunamiProducts(pool: Pool): Promise<TsunamiProduct[]> {
  const result = await pool.query<{
    product_id: string;
    source: "NOAA_PTWC" | "NOAA_NTWC";
    identifier: string;
    center: string;
    event: string;
    status: string;
    message_type: string;
    urgency: string | null;
    severity: string | null;
    certainty: string | null;
    sent_at_utc: Date;
    onset_at_utc: Date | null;
    expires_at_utc: Date | null;
    headline: string | null;
    description: string | null;
    instruction: string | null;
    area_description: string | null;
    source_url: string | null;
  }>(
    `
      SELECT
        product_id, source, identifier, center, event, status, message_type,
        urgency, severity, certainty, sent_at_utc, onset_at_utc,
        expires_at_utc, headline, description, instruction,
        area_description, source_url
      FROM tsunami_products
      WHERE sent_at_utc >= NOW() - INTERVAL '24 hours'
        OR expires_at_utc >= NOW()
      ORDER BY sent_at_utc DESC
      LIMIT 20
    `
  );
  return result.rows.map((row) => ({
    productId: row.product_id,
    source: row.source,
    identifier: row.identifier,
    center: row.center,
    event: row.event,
    status: row.status,
    messageType: row.message_type,
    urgency: row.urgency,
    severity: row.severity,
    certainty: row.certainty,
    sentAtUtc: row.sent_at_utc.toISOString(),
    onsetAtUtc: row.onset_at_utc?.toISOString() ?? null,
    expiresAtUtc: row.expires_at_utc?.toISOString() ?? null,
    headline: row.headline,
    description: row.description,
    instruction: row.instruction,
    areaDescription: row.area_description,
    sourceUrl: row.source_url
  }));
}
