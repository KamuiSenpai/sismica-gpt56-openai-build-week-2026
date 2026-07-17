import { z } from "zod";

import { env } from "../config/env.js";

const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const eventExplanationRequestSchema = z
  .object({
    eventId: z.string().trim().min(1).max(200),
    source: z.string().trim().min(1).max(30),
    title: z.string().trim().min(1).max(300),
    magnitude: z.number().finite().nullable(),
    magnitudeType: nullableText(20),
    depthKm: z.number().finite().nullable(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    eventTimeUtc: z.string().datetime({ offset: true }),
    status: nullableText(40),
    tsunami: z.boolean(),
    sourceUrl: z.string().url().max(1000).nullable()
  })
  .strict();

export type EventExplanationRequest = z.infer<typeof eventExplanationRequestSchema>;

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

export type EventExplanationResult = {
  provider: "openai";
  model: string;
  responseId: string;
  generatedAtUtc: string;
  disclaimer: string;
  explanation: EventExplanation;
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
  error?: { message?: string };
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

const SYSTEM_PROMPT = [
  "Actua como divulgador sismico para una audiencia general y responde en espanol claro.",
  "Usa exclusivamente los hechos incluidos en el JSON del usuario.",
  "No inventes danos, victimas, intensidad sentida, reportes ciudadanos ni alertas oficiales.",
  "No predigas replicas ni futuros terremotos.",
  "No afirmes un mecanismo tectonico porque no forma parte de la entrada.",
  "Magnitud no equivale a intensidad o danos.",
  "tsunami=true es solo un indicador de la fuente, no una amenaza o alerta confirmada.",
  "Las acciones deben ser generales y siempre remitir a autoridades locales y fuentes oficiales.",
  "Explica tambien que conclusiones no permiten los datos disponibles."
].join(" ");

export const OPENAI_EXPLAINER_DISCLAIMER =
  "Explicacion educativa generada por IA. No sustituye alertas ni instrucciones de autoridades oficiales.";

export class OpenAiExplainerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiExplainerUnavailableError";
  }
}

export class OpenAiExplainerResponseError extends Error {
  constructor(message: string) {
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
        throw new OpenAiExplainerResponseError("GPT-5.6 rechazo generar la explicacion");
      }
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  return null;
}

export function isOpenAiExplainerConfigured(): boolean {
  return env.openaiEnabled && Boolean(env.openaiApiKey);
}

export async function explainSeismicEvent(
  input: EventExplanationRequest,
  dependencies: ExplainDependencies = {}
): Promise<EventExplanationResult> {
  const config = dependencies.config ?? runtimeConfig();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());

  if (!config.enabled) {
    throw new OpenAiExplainerUnavailableError("OpenAI deshabilitado (OPENAI_ENABLED=false)");
  }
  if (!config.apiKey) {
    throw new OpenAiExplainerUnavailableError("Falta OPENAI_API_KEY");
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
  } catch (error) {
    throw new OpenAiExplainerUnavailableError(
      `No se pudo contactar OpenAI: ${error instanceof Error ? error.message : "error de red"}`
    );
  }

  let payload: ResponsesApiPayload;
  try {
    payload = (await response.json()) as ResponsesApiPayload;
  } catch {
    throw new OpenAiExplainerResponseError(`OpenAI respondio ${response.status} sin JSON valido`);
  }

  if (!response.ok) {
    throw new OpenAiExplainerUnavailableError(
      `OpenAI respondio ${response.status}${payload.error?.message ? `: ${payload.error.message}` : ""}`
    );
  }

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
    explanation: explanation.data
  };
}
