import { env } from "../config/env.js";

// DeepSeek es compatible con la API de OpenAI (POST /chat/completions).
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// La pauta editorial no puede retrasar la locucion. Si DeepSeek no responde rapido,
// el llamador usa inmediatamente las aperturas y el contexto tectonico locales.
const CHAT_TIMEOUT_MS = 2_000;

// Error de "IA no disponible" -> el llamador cae a la plantilla.
export class DeepSeekUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekUnavailableError";
  }
}

export function isDeepSeekConfigured(): boolean {
  return env.deepseekEnabled && Boolean(env.deepseekApiKey);
}

type ChatResponse = { choices?: Array<{ message?: { content?: string } }> };

export async function chat(
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  if (!env.deepseekEnabled) {
    throw new DeepSeekUnavailableError("DeepSeek deshabilitado (DEEPSEEK_ENABLED=false)");
  }
  if (!env.deepseekApiKey) {
    throw new DeepSeekUnavailableError("Falta DEEPSEEK_API_KEY");
  }

  let response: Response;
  try {
    response = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.deepseekApiKey}`
      },
      body: JSON.stringify({
        model: env.deepseekModel,
        messages,
        max_tokens: options.maxTokens ?? env.deepseekMaxTokens,
        temperature: options.temperature ?? 1.0,
        stream: false
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? CHAT_TIMEOUT_MS)
    });
  } catch (error) {
    throw new DeepSeekUnavailableError(
      `No se pudo contactar DeepSeek: ${error instanceof Error ? error.message : "error"}`
    );
  }

  if (!response.ok) {
    throw new DeepSeekUnavailableError(`DeepSeek respondio ${response.status}`);
  }

  const data = (await response.json()) as ChatResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new DeepSeekUnavailableError("DeepSeek devolvio una respuesta vacia");
  }
  return content;
}
