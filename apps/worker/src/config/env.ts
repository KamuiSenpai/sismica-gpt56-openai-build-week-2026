import { config } from "dotenv";
import { z } from "zod";

config({ path: new URL("../../../../.env", import.meta.url) });

// "" o undefined -> usa el default; cualquier otro valor se coacciona a numero.
const numberEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().positive().default(fallback)
  );

const urlEnv = (fallback: string) => z.string().url().default(fallback);

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  USGS_FEED_URL: urlEnv("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"),
  CWA_AUTHORIZATION: z.string().min(1).optional(),
  CWA_EARTHQUAKE_URL: urlEnv(
    "https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0016-002?format=JSON&limit=100"
  ),
  EMSC_FDSN_URL: urlEnv("https://www.seismicportal.eu/fdsnws/event/1/query"),
  GEOFON_FDSN_URL: urlEnv("https://geofon.gfz.de/fdsnws/event/1/query"),
  GEONET_QUAKE_URL: urlEnv("https://api.geonet.org.nz/quake?MMI=-1"),
  BMKG_LATEST_URL: urlEnv("https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json"),
  BMKG_FELT_URL: urlEnv("https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json"),
  JMA_LIST_URL: urlEnv("https://www.jma.go.jp/bosai/quake/data/list.json"),
  // Template con marcador {year}; no es una URL completa valida, se valida como texto.
  IGP_FEED_URL_TEMPLATE: z
    .string()
    .min(1)
    .default("https://ultimosismo.igp.gob.pe/api/ultimo-sismo/ajaxb/{year}"),
  FUNVISIS_FEED_URL: urlEnv("http://www.funvisis.gob.ve/maravilla.json"),
  GDACS_API_URL: urlEnv("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"),
  NOAA_PTWC_CAP_URL: urlEnv("https://www.tsunami.gov/events/xml/PHEBCAP.xml"),
  NOAA_NTWC_CAP_URL: urlEnv("https://www.tsunami.gov/events/xml/PAAQCAP.xml"),
  POLL_INTERVAL_MS: numberEnv(60000),
  SOURCE_TIMEOUT_MS: numberEnv(20000),
  SOURCE_WINDOW_HOURS: numberEnv(72),
  RUN_ONCE: z
    .string()
    .optional()
    .transform((value) => (value ?? "false").toLowerCase() === "true"),
  STREAM_CHANNEL: z.string().min(1).default("seismic_events_channel")
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Variables de entorno invalidas:\n${details}`);
}

export const env = {
  databaseUrl: parsed.data.DATABASE_URL,
  usgsFeedUrl: parsed.data.USGS_FEED_URL,
  cwaAuthorization: parsed.data.CWA_AUTHORIZATION,
  cwaEarthquakeUrl: parsed.data.CWA_EARTHQUAKE_URL,
  emscFdsnUrl: parsed.data.EMSC_FDSN_URL,
  geofonFdsnUrl: parsed.data.GEOFON_FDSN_URL,
  geoNetQuakeUrl: parsed.data.GEONET_QUAKE_URL,
  bmkgLatestUrl: parsed.data.BMKG_LATEST_URL,
  bmkgFeltUrl: parsed.data.BMKG_FELT_URL,
  jmaListUrl: parsed.data.JMA_LIST_URL,
  igpFeedUrlTemplate: parsed.data.IGP_FEED_URL_TEMPLATE,
  funvisisFeedUrl: parsed.data.FUNVISIS_FEED_URL,
  gdacsApiUrl: parsed.data.GDACS_API_URL,
  noaaPtwcCapUrl: parsed.data.NOAA_PTWC_CAP_URL,
  noaaNtwcCapUrl: parsed.data.NOAA_NTWC_CAP_URL,
  pollIntervalMs: parsed.data.POLL_INTERVAL_MS,
  sourceTimeoutMs: parsed.data.SOURCE_TIMEOUT_MS,
  sourceWindowHours: parsed.data.SOURCE_WINDOW_HOURS,
  runOnce: parsed.data.RUN_ONCE,
  streamChannel: parsed.data.STREAM_CHANNEL
};
