import { config } from "dotenv";
import { z } from "zod";

config({ path: new URL("../../../../.env", import.meta.url) });

// "" o undefined -> usa el default; cualquier otro valor se coacciona a numero.
const numberEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().positive().default(fallback)
  );
const channelEnv = (fallback: string) =>
  z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/i)
    .default(fallback);
// "true"/"1"/"yes"/"on" -> true; "" o undefined -> usa el default.
const booleanEnv = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === "" || value === undefined) return undefined;
    if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    return value;
  }, z.boolean().default(fallback));
const optionalStringEnv = (minimumLength = 1) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(minimumLength).optional()
  );
const optionalUrlEnv = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional()
);
const youtubeChatModeEnv = z.enum(["off", "dry-run", "live"]).default("off");

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: numberEnv(3000),
  FRONTEND_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  API_TRUST_PROXY: booleanEnv(false),
  API_OPERATOR_TOKEN: optionalStringEnv(24),
  API_RATE_LIMIT_WINDOW_MS: numberEnv(60000),
  API_AI_RATE_LIMIT_MAX: numberEnv(10),
  API_COMPUTE_RATE_LIMIT_MAX: numberEnv(120),
  ANALYTICS_REFRESH_INTERVAL_MS: numberEnv(3600000),
  ANALYTICS_REFRESH_BATCH_SIZE: numberEnv(50000),
  STREAM_CHANNEL: channelEnv("seismic_events_channel"),
  STATION_STREAM_CHANNEL: channelEnv("seismic_station_states_channel"),
  SEISMIC_ENGINE_TOKEN: optionalStringEnv(24),
  // --- TTS neural local (Piper + proxy a XTTS-v2) ---
  TTS_ENABLED: booleanEnv(false),
  PIPER_BINARY_PATH: optionalStringEnv(),
  PIPER_VOICE_MODEL: optionalStringEnv(),
  PIPER_USE_CUDA: booleanEnv(false),
  XTTS_ENABLED: booleanEnv(false),
  XTTS_SERVICE_URL: optionalUrlEnv,
  CHATTERBOX_SERVICE_URL: optionalUrlEnv,
  TTS_CACHE_DIR: optionalStringEnv(),
  TTS_MAX_TEXT_LENGTH: numberEnv(600),
  // --- Narracion por IA (DeepSeek) ---
  DEEPSEEK_ENABLED: booleanEnv(false),
  DEEPSEEK_API_KEY: optionalStringEnv(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().min(1).default("deepseek-chat"),
  DEEPSEEK_MAX_TOKENS: numberEnv(120),
  DEEPSEEK_RATE_PER_MIN: numberEnv(30),
  // --- Build Week: explicador sismico con OpenAI Responses API ---
  OPENAI_ENABLED: booleanEnv(false),
  OPENAI_API_KEY: optionalStringEnv(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6"),
  OPENAI_TIMEOUT_MS: numberEnv(15000),
  USGS_IMPACT_TIMEOUT_MS: numberEnv(10000),
  USGS_IMPACT_CACHE_TTL_MS: numberEnv(120000),
  USGS_IMPACT_MAX_DOCUMENT_BYTES: numberEnv(5242880),
  USGS_IMPACT_MAX_GEOJSON_BYTES: numberEnv(15728640),
  YOUTUBE_CHAT_ENABLED: booleanEnv(false),
  YOUTUBE_CHAT_MODE: youtubeChatModeEnv,
  YOUTUBE_CHAT_CLIENT_ID: optionalStringEnv(),
  YOUTUBE_CHAT_CLIENT_SECRET: optionalStringEnv(),
  YOUTUBE_CHAT_REFRESH_TOKEN: optionalStringEnv(),
  YOUTUBE_CHAT_CHANNEL_ID: optionalStringEnv(),
  YOUTUBE_CHAT_MIN_INTERVAL_MS: numberEnv(12000),
  YOUTUBE_CHAT_MAX_EVENT_AGE_MINUTES: numberEnv(20),
  YOUTUBE_CHAT_MAX_QUEUE_SIZE: numberEnv(200),
  YOUTUBE_CHAT_STALE_QUEUE_MS: numberEnv(180000),
  YOUTUBE_CHAT_PROMOTIONAL_ENABLED: booleanEnv(true),
  YOUTUBE_CHAT_PROMOTIONAL_MIN_INTERVAL_MS: numberEnv(1200000)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Variables de entorno invalidas:\n${details}`);
}

export const env = {
  apiPort: parsed.data.API_PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  frontendOrigin: parsed.data.FRONTEND_ORIGIN,
  apiTrustProxy: parsed.data.API_TRUST_PROXY,
  apiOperatorToken: parsed.data.API_OPERATOR_TOKEN,
  apiRateLimitWindowMs: parsed.data.API_RATE_LIMIT_WINDOW_MS,
  apiAiRateLimitMax: parsed.data.API_AI_RATE_LIMIT_MAX,
  apiComputeRateLimitMax: parsed.data.API_COMPUTE_RATE_LIMIT_MAX,
  analyticsRefreshIntervalMs: parsed.data.ANALYTICS_REFRESH_INTERVAL_MS,
  analyticsRefreshBatchSize: parsed.data.ANALYTICS_REFRESH_BATCH_SIZE,
  streamChannel: parsed.data.STREAM_CHANNEL,
  stationStreamChannel: parsed.data.STATION_STREAM_CHANNEL,
  seismicEngineToken: parsed.data.SEISMIC_ENGINE_TOKEN,
  ttsEnabled: parsed.data.TTS_ENABLED,
  piperBinaryPath: parsed.data.PIPER_BINARY_PATH,
  piperVoiceModel: parsed.data.PIPER_VOICE_MODEL,
  piperUseCuda: parsed.data.PIPER_USE_CUDA,
  xttsEnabled: parsed.data.XTTS_ENABLED,
  xttsServiceUrl: parsed.data.XTTS_SERVICE_URL,
  chatterboxServiceUrl: parsed.data.CHATTERBOX_SERVICE_URL,
  ttsCacheDir: parsed.data.TTS_CACHE_DIR,
  ttsMaxTextLength: parsed.data.TTS_MAX_TEXT_LENGTH,
  deepseekEnabled: parsed.data.DEEPSEEK_ENABLED,
  deepseekApiKey: parsed.data.DEEPSEEK_API_KEY,
  deepseekBaseUrl: parsed.data.DEEPSEEK_BASE_URL,
  deepseekModel: parsed.data.DEEPSEEK_MODEL,
  deepseekMaxTokens: parsed.data.DEEPSEEK_MAX_TOKENS,
  deepseekRatePerMin: parsed.data.DEEPSEEK_RATE_PER_MIN,
  openaiEnabled: parsed.data.OPENAI_ENABLED,
  openaiApiKey: parsed.data.OPENAI_API_KEY,
  openaiBaseUrl: parsed.data.OPENAI_BASE_URL,
  openaiModel: parsed.data.OPENAI_MODEL,
  openaiTimeoutMs: parsed.data.OPENAI_TIMEOUT_MS,
  usgsImpactTimeoutMs: parsed.data.USGS_IMPACT_TIMEOUT_MS,
  usgsImpactCacheTtlMs: parsed.data.USGS_IMPACT_CACHE_TTL_MS,
  usgsImpactMaxDocumentBytes: parsed.data.USGS_IMPACT_MAX_DOCUMENT_BYTES,
  usgsImpactMaxGeoJsonBytes: parsed.data.USGS_IMPACT_MAX_GEOJSON_BYTES,
  youtubeChatEnabled: parsed.data.YOUTUBE_CHAT_ENABLED,
  youtubeChatMode: parsed.data.YOUTUBE_CHAT_MODE,
  youtubeChatClientId: parsed.data.YOUTUBE_CHAT_CLIENT_ID,
  youtubeChatClientSecret: parsed.data.YOUTUBE_CHAT_CLIENT_SECRET,
  youtubeChatRefreshToken: parsed.data.YOUTUBE_CHAT_REFRESH_TOKEN,
  youtubeChatChannelId: parsed.data.YOUTUBE_CHAT_CHANNEL_ID,
  youtubeChatMinIntervalMs: parsed.data.YOUTUBE_CHAT_MIN_INTERVAL_MS,
  youtubeChatMaxEventAgeMinutes: parsed.data.YOUTUBE_CHAT_MAX_EVENT_AGE_MINUTES,
  youtubeChatMaxQueueSize: parsed.data.YOUTUBE_CHAT_MAX_QUEUE_SIZE,
  youtubeChatStaleQueueMs: parsed.data.YOUTUBE_CHAT_STALE_QUEUE_MS,
  youtubeChatPromotionalEnabled: parsed.data.YOUTUBE_CHAT_PROMOTIONAL_ENABLED,
  youtubeChatPromotionalMinIntervalMs: parsed.data.YOUTUBE_CHAT_PROMOTIONAL_MIN_INTERVAL_MS
};
