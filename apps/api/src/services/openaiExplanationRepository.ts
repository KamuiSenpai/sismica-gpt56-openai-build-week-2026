import { type Pool } from "pg";

import { type EventExplanationResult } from "./openaiExplainerService.js";

export type ExplanationCacheKey = {
  eventId: string;
  eventVersionUtc: string;
  requestedModel: string;
  inputSha256: string;
};

type AuditContext = ExplanationCacheKey & {
  requestId: string;
  requestedAtUtc: string;
  latencyMs: number;
};

export async function getCachedEventExplanation(
  database: Pool,
  key: ExplanationCacheKey
): Promise<EventExplanationResult | null> {
  const result = await database.query<{ result_json: EventExplanationResult }>(
    `
      SELECT result_json
      FROM openai_event_explanation_audit
      WHERE event_id = $1
        AND event_version_utc = $2
        AND requested_model = $3
        AND input_sha256 = $4
        AND status = 'completed'
      ORDER BY completed_at_utc DESC
      LIMIT 1
    `,
    [key.eventId, key.eventVersionUtc, key.requestedModel, key.inputSha256]
  );
  return result.rows[0]?.result_json ? { ...result.rows[0].result_json, cached: true } : null;
}

export async function recordEventExplanationSuccess(
  database: Pool,
  context: AuditContext,
  result: EventExplanationResult
): Promise<void> {
  await database.query(
    `
      INSERT INTO openai_event_explanation_audit (
        event_id, event_version_utc, requested_model, response_model, response_id,
        input_sha256, status, request_id, requested_at_utc, completed_at_utc,
        latency_ms, input_tokens, output_tokens, total_tokens, result_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, NOW(), $9, $10, $11, $12, $13::jsonb)
      ON CONFLICT (event_id, event_version_utc, requested_model, input_sha256)
        WHERE status = 'completed'
      DO NOTHING
    `,
    [
      context.eventId,
      context.eventVersionUtc,
      context.requestedModel,
      result.model,
      result.responseId,
      context.inputSha256,
      context.requestId,
      context.requestedAtUtc,
      context.latencyMs,
      result.usage.inputTokens,
      result.usage.outputTokens,
      result.usage.totalTokens,
      JSON.stringify(result)
    ]
  );
}

export async function recordEventExplanationFailure(
  database: Pool,
  context: AuditContext,
  error: { code: string; providerStatus: number | null }
): Promise<void> {
  await database.query(
    `
      INSERT INTO openai_event_explanation_audit (
        event_id, event_version_utc, requested_model, input_sha256, status,
        request_id, requested_at_utc, completed_at_utc, latency_ms, error_code,
        provider_status
      )
      VALUES ($1, $2, $3, $4, 'failed', $5, $6, NOW(), $7, $8, $9)
    `,
    [
      context.eventId,
      context.eventVersionUtc,
      context.requestedModel,
      context.inputSha256,
      context.requestId,
      context.requestedAtUtc,
      context.latencyMs,
      error.code,
      error.providerStatus
    ]
  );
}
