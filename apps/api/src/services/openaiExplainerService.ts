import { createHash } from "node:crypto";

import { z } from "zod";

import { env } from "../config/env.js";

export const eventExplanationRequestSchema = z
  .object({
    eventId: z.string().trim().min(1).max(200)
  })
  .strict();

export type GroundedEventExplanationInput = {
  eventId: string;
  source: string;
  title: string;
  magnitude: number | null;
  magnitudeType: string | null;
  depthKm: number | null;
  latitude: number;
  longitude: number;
  eventTimeUtc: string;
  status: string | null;
  tsunami: boolean;
  sources: string[];
  references: Array<{
    source: string;
    sourceEventId: string;
    magnitude: number | null;
    eventTimeUtc: string;
    updatedAtUtc: string | null;
  }>;
};

export const eventExplanationSchema = z
  .object({
    headline: z.string().trim().min(1).max(120),
    overview: z.string().trim().min(1).max(900),
    technicalReading: z.string().trim().min(1).max(900),
    recommendedActions: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
    dataLimitations: z.array(z.string().trim().min(1).max(300)).min(1).max(5)
  })
  .strict();

export type EventExplanation = z.infer<typeof eventExplanationSchema>;

export type OpenAiUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type OpenAiProviderExplanationResult = {
  provider: "openai";
  model: string;
  responseId: string;
  generatedAtUtc: string;
  disclaimer: string;
  usage: OpenAiUsage;
  explanation: EventExplanation;
};

export type EventExplanationResult = OpenAiProviderExplanationResult & {
  cached: boolean;
  grounding: {
    eventId: string;
    eventVersionUtc: string;
    sourceCount: number;
    inputSha256: string;
  };
};

type OpenAiConfig = {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

type ResponsesApiPayload = {
  id?: string;
  model?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: { code?: string; type?: string };
};

type ExplainDependencies = {
  config?: OpenAiConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    overview: { type: "string" },
    technicalReading: { type: "string" },
    recommendedActions: { type: "array", items: { type: "string" } },
    dataLimitations: { type: "array", items: { type: "string" } }
  },
  required: ["headline", "overview", "technicalReading", "recommendedActions", "dataLimitations"],
  additionalProperties: false
} as const;

const PROMPT_VERSION = "2026-07-17.1";
const SYSTEM_PROMPT = [
  "Actua como divulgador sismico para una audiencia general y responde en espanol claro.",
  "Usa exclusivamente los hechos incluidos en el JSON del usuario.",
  "No inventes danos, victimas, intensidad sentida, reportes ciudadanos ni alertas oficiales.",
  "No predigas replicas ni futuros terremotos.",
  "No afirmes un mecanismo tectonico porque no forma parte de la entrada.",
  "Magnitud no equivale a intensidad o danos.",
  "tsunami=true es solo un indicador de la fuente, no una amenaza o alerta confirmada.",
  "Las referencias representan reportes asociados, no observaciones independientes garantizadas.",
  "Las acciones deben ser generales y siempre remitir a autoridades locales y fuentes oficiales.",
  "Explica tambien que conclusiones no permiten los datos disponibles."
].join(" ");

export const OPENAI_EXPLAINER_DISCLAIMER =
  "Explicacion educativa generada por IA. No sustituye alertas ni instrucciones de autoridades oficiales.";

export class OpenAiExplainerUnavailableError extends Error {
  constructor(
    message: string,
    readonly code = "openai_unavailable",
    readonly providerStatus: number | null = null
  ) {
    super(message);
    this.name = "OpenAiExplainerUnavailableError";
  }
}

export class OpenAiExplainerResponseError extends Error {
  constructor(
    message: string,
    readonly code = "openai_invalid_response"
  ) {
    super(message);
    this.name = "OpenAiExplainerResponseError";
  }
}

function runtimeConfig(): OpenAiConfig {
  return {
    enabled: env.openaiEnabled,
    apiKey: env.openaiApiKey,
    baseUrl: env.openaiBaseUrl,
    model: env.openaiModel,
    timeoutMs: env.openaiTimeoutMs
  };
}

function extractOutputText(payload: ResponsesApiPayload): string | null {
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal" || content.refusal) {
        throw new OpenAiExplainerResponseError("GPT-5.6 rechazo generar la explicacion", "model_refusal");
      }
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  return null;
}

function providerError(status: number, payload: ResponsesApiPayload): OpenAiExplainerUnavailableError {
  const providerCode = payload.error?.code ?? payload.error?.type ?? "unknown";
  if (status === 401 || status === 403) {
    return new OpenAiExplainerUnavailableError(
      "OpenAI rechazo la autenticacion del servidor",
      "openai_auth_failed",
      status
    );
  }
  if (status === 429) {
    return new OpenAiExplainerUnavailableError(
      "OpenAI no tiene cuota disponible o aplico un limite temporal",
      providerCode === "insufficient_quota" ? "openai_insufficient_quota" : "openai_rate_limited",
      status
    );
  }
  if (status >= 500) {
    return new OpenAiExplainerUnavailableError(
      "OpenAI no esta disponible temporalmente",
      "openai_provider_error",
      status
    );
  }
  return new OpenAiExplainerUnavailableError(
    "OpenAI rechazo la solicitud del servidor",
    "openai_request_rejected",
    status
  );
}

export function eventExplanationInputHash(input: GroundedEventExplanationInput): string {
  return createHash("sha256")
    .update(JSON.stringify({ promptVersion: PROMPT_VERSION, input }))
    .digest("hex");
}

export function isOpenAiExplainerConfigured(): boolean {
  return env.openaiEnabled && Boolean(env.openaiApiKey);
}

export async function explainSeismicEvent(
  input: GroundedEventExplanationInput,
  dependencies: ExplainDependencies = {}
): Promise<OpenAiProviderExplanationResult> {
  const config = dependencies.config ?? runtimeConfig();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());

  if (!config.enabled) {
    throw new OpenAiExplainerUnavailableError(
      "OpenAI deshabilitado (OPENAI_ENABLED=false)",
      "openai_disabled"
    );
  }
  if (!config.apiKey) {
    throw new OpenAiExplainerUnavailableError("Falta OPENAI_API_KEY", "openai_key_missing");
  }

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        store: false,
        reasoning: { effort: "medium" },
        max_output_tokens: 1200,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(input) }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "seismic_event_explanation",
            strict: true,
            schema: RESPONSE_SCHEMA
          }
        }
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    });
  } catch {
    throw new OpenAiExplainerUnavailableError("No se pudo contactar OpenAI", "openai_network_error");
  }

  let payload: ResponsesApiPayload;
  try {
    payload = (await response.json()) as ResponsesApiPayload;
  } catch {
    throw new OpenAiExplainerResponseError(`OpenAI respondio ${response.status} sin JSON valido`);
  }

  if (!response.ok) throw providerError(response.status, payload);
  if (!payload.id?.trim()) {
    throw new OpenAiExplainerResponseError("OpenAI no devolvio response_id");
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new OpenAiExplainerResponseError("OpenAI devolvio una respuesta vacia");
  }

  let rawExplanation: unknown;
  try {
    rawExplanation = JSON.parse(outputText);
  } catch {
    throw new OpenAiExplainerResponseError("GPT-5.6 devolvio JSON invalido");
  }

  const explanation = eventExplanationSchema.safeParse(rawExplanation);
  if (!explanation.success) {
    throw new OpenAiExplainerResponseError("La salida de GPT-5.6 no cumple el esquema esperado");
  }

  return {
    provider: "openai",
    model: payload.model?.trim() || config.model,
    responseId: payload.id,
    generatedAtUtc: now().toISOString(),
    disclaimer: OPENAI_EXPLAINER_DISCLAIMER,
    usage: {
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
      totalTokens: payload.usage?.total_tokens ?? null
    },
    explanation: explanation.data
  };
}
