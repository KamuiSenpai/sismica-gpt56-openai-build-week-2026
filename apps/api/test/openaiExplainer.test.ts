import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_ENABLED = "false";

const {
  eventExplanationRequestSchema,
  eventExplanationInputHash,
  explainSeismicEvent,
  OpenAiExplainerResponseError,
  OpenAiExplainerUnavailableError
} = await import("../src/services/openaiExplainerService.js");

const request = { eventId: "IGP:2026-001" };

const groundedInput = {
  eventId: "IGP:2026-001",
  source: "IGP",
  title: "M4.8 - Costa de Arequipa, Peru",
  magnitude: 4.8,
  magnitudeType: "mb",
  depthKm: 38,
  latitude: -16.4,
  longitude: -73.1,
  eventTimeUtc: "2026-07-17T19:30:00.000Z",
  status: "reviewed",
  tsunami: false,
  sources: ["IGP"],
  references: [
    {
      source: "IGP",
      sourceEventId: "2026-001",
      magnitude: 4.8,
      eventTimeUtc: "2026-07-17T19:30:00.000Z",
      updatedAtUtc: null
    }
  ]
};

const config = {
  enabled: true,
  apiKey: "test-key-not-real",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.6",
  timeoutMs: 5000
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("eventExplanationRequestSchema acepta solo eventId", () => {
  assert.equal(eventExplanationRequestSchema.safeParse(request).success, true);
  assert.equal(eventExplanationRequestSchema.safeParse({ ...request, source: "IGP" }).success, false);
  assert.equal(eventExplanationRequestSchema.safeParse({ ...request, eventId: "" }).success, false);
  assert.equal(eventExplanationInputHash(groundedInput), eventExplanationInputHash(groundedInput));
  assert.notEqual(
    eventExplanationInputHash(groundedInput),
    eventExplanationInputHash({ ...groundedInput, magnitude: 4.9 })
  );
});

test("explainSeismicEvent exige habilitacion y API key", async () => {
  await assert.rejects(
    () => explainSeismicEvent(groundedInput, { config: { ...config, enabled: false } }),
    OpenAiExplainerUnavailableError
  );
  await assert.rejects(
    () => explainSeismicEvent(groundedInput, { config: { ...config, apiKey: undefined } }),
    OpenAiExplainerUnavailableError
  );
});

test("explainSeismicEvent usa Responses API, GPT-5.6 y JSON Schema estricto", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return jsonResponse({
      id: "resp_build_week_001",
      model: "gpt-5.6-sol-2026-07-13",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                headline: "Sismo moderado frente a Arequipa",
                overview: "La fuente reporta un evento de magnitud 4.8 frente a Arequipa.",
                technicalReading: "La magnitud describe energia liberada y no determina danos por si sola.",
                recommendedActions: ["Revise los comunicados de las autoridades oficiales."],
                dataLimitations: ["Estos datos no informan danos ni intensidad sentida."]
              })
            }
          ]
        }
      ]
    });
  };

  const result = await explainSeismicEvent(groundedInput, {
    config,
    fetchImpl,
    now: () => new Date("2026-07-17T20:00:00.000Z")
  });

  assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
  const body = JSON.parse(String(capturedInit?.body)) as {
    model: string;
    store: boolean;
    input: Array<{ content: string }>;
    text: {
      format: {
        type: string;
        strict: boolean;
        schema: { additionalProperties: boolean };
      };
    };
  };
  assert.equal(body.model, "gpt-5.6");
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.equal(String(body.input[0].content).includes("No predigas replicas"), true);
  assert.equal(String(body.input[1].content).includes("test-key-not-real"), false);
  assert.equal(
    capturedInit?.headers && JSON.stringify(capturedInit.headers).includes("test-key-not-real"),
    true
  );
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5.6-sol-2026-07-13");
  assert.equal(result.responseId, "resp_build_week_001");
  assert.equal(result.generatedAtUtc, "2026-07-17T20:00:00.000Z");
  assert.match(result.disclaimer, /autoridades oficiales/i);
});

test("explainSeismicEvent rechaza salida vacia o fuera de esquema", async () => {
  const emptyFetch: typeof fetch = async () =>
    jsonResponse({ id: "resp_empty", model: "gpt-5.6", output: [] });
  await assert.rejects(
    () => explainSeismicEvent(groundedInput, { config, fetchImpl: emptyFetch }),
    OpenAiExplainerResponseError
  );

  const invalidFetch: typeof fetch = async () =>
    jsonResponse({
      id: "resp_invalid",
      model: "gpt-5.6",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({ headline: "Incompleto" }) }]
        }
      ]
    });
  await assert.rejects(
    () => explainSeismicEvent(groundedInput, { config, fetchImpl: invalidFetch }),
    OpenAiExplainerResponseError
  );
});

test("explainSeismicEvent detecta una negativa estructurada del modelo", async () => {
  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
      id: "resp_refusal",
      model: "gpt-5.6",
      output: [
        {
          type: "message",
          content: [{ type: "refusal", refusal: "No puedo ayudar con esa solicitud." }]
        }
      ]
    });

  await assert.rejects(
    () => explainSeismicEvent(groundedInput, { config, fetchImpl }),
    OpenAiExplainerResponseError
  );
});
