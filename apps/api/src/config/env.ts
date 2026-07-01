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

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: numberEnv(3000),
  FRONTEND_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  STREAM_CHANNEL: channelEnv("seismic_events_channel"),
  STATION_STREAM_CHANNEL: channelEnv("seismic_station_states_channel"),
  SEISMIC_ENGINE_TOKEN: z.string().min(24).optional()
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
  streamChannel: parsed.data.STREAM_CHANNEL,
  stationStreamChannel: parsed.data.STATION_STREAM_CHANNEL,
  seismicEngineToken: parsed.data.SEISMIC_ENGINE_TOKEN
};
