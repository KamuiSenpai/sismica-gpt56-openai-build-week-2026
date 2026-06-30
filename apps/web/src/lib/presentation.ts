import { type SeismicEvent } from "@sismica/shared";

type EventQualityTone = "quality-a" | "quality-b" | "quality-c" | "quality-v";

type EventStatusBadge = {
  label: string;
  tone: EventQualityTone;
  description: string;
};

const MAGNITUDE_PREFIX = /^M\s*\d+(?:\.\d+)?\s*-\s*/i;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toUtcDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatUtcDateTime(value: string | null | undefined): string {
  const parsed = toUtcDate(value);
  if (!parsed) {
    return "--";
  }

  return [
    `${pad(parsed.getUTCDate())}/${pad(parsed.getUTCMonth() + 1)}/${parsed.getUTCFullYear()}`,
    `${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}:${pad(parsed.getUTCSeconds())}`
  ].join(" ");
}

export function formatUtcClock(value: Date): string {
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
}

export function formatMagnitude(value: number | null | undefined): string {
  return typeof value === "number" ? `M${value.toFixed(1)}` : "M?";
}

export function formatDepth(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(0)} km` : "-- km";
}

export function formatCoordinate(value: number, axis: "lat" | "lon"): string {
  const suffix = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(3)}${suffix}`;
}

function titleCase(text: string): string {
  return text
    .toLocaleLowerCase("es")
    .replace(
      /(^|[\s,./\-(])(\p{L})/gu,
      (_match, sep: string, ch: string) => sep + ch.toLocaleUpperCase("es")
    );
}

// Limpia el descriptor: quita un sufijo de pais cripto (IGN "...POR") y pasa
// los textos TODO-MAYUSCULAS (EMSC) a Tipo Titulo, sin alterar los demas.
function cleanDescriptor(text: string): string {
  const withoutSuffix = text.replace(/\.[A-Z]{2,3}$/, "").trim();
  const hasLower = /\p{Ll}/u.test(withoutSuffix);
  const hasUpper = /\p{Lu}/u.test(withoutSuffix);
  return !hasLower && hasUpper ? titleCase(withoutSuffix) : withoutSuffix;
}

export function getEventPlace(title: string): string {
  const stripped = title.replace(MAGNITUDE_PREFIX, "").trim();
  return cleanDescriptor(stripped) || title;
}

export const EVENT_STATUS_LEGEND: EventStatusBadge[] = [
  { label: "A", tone: "quality-c", description: "Automatico" },
  { label: "O", tone: "quality-a", description: "Oficial" },
  { label: "R", tone: "quality-a", description: "Revisado" },
  { label: "P", tone: "quality-b", description: "Preliminar" },
  { label: "V", tone: "quality-v", description: "Validation" },
  { label: "?", tone: "quality-b", description: "Sin estado" }
];

export function getEventStatusBadge(status: SeismicEvent["status"]): EventStatusBadge {
  const normalized = status?.toLowerCase();
  switch (normalized) {
    case "reviewed":
      return { label: "R", tone: "quality-a", description: "Revisado" };
    case "automatic":
      return { label: "A", tone: "quality-c", description: "Automatico" };
    case "official":
      return { label: "O", tone: "quality-a", description: "Oficial" };
    case "preliminary":
      return { label: "P", tone: "quality-b", description: "Preliminar" };
    case "validation":
      return { label: "V", tone: "quality-v", description: "Validation" };
    default:
      return { label: "?", tone: "quality-b", description: normalized ?? "Sin estado" };
  }
}

export function formatMetric(value: number | null | undefined, unit = "", decimals = 1): string {
  return typeof value === "number" ? `${value.toFixed(decimals)}${unit}` : "N/D";
}

// Color por banda de magnitud (mismas clases que los puntos del globo).
const MAGNITUDE_COLORS: { max: number; color: string }[] = [
  { max: 2, color: "#22c55e" },
  { max: 4, color: "#a3e635" },
  { max: 5, color: "#facc15" },
  { max: 6, color: "#fb923c" },
  { max: 7, color: "#ef4444" },
  { max: Number.POSITIVE_INFINITY, color: "#b91c1c" }
];

export function magnitudeCssColor(magnitude: number | null | undefined): string {
  if (typeof magnitude !== "number") return "#64748b";
  return (
    MAGNITUDE_COLORS.find((band) => magnitude < band.max) ?? MAGNITUDE_COLORS[MAGNITUDE_COLORS.length - 1]
  ).color;
}

export const INTENSITY_BANDS = [
  { mmi: 1, color: "#ffffff", label: "I (No sentido)" },
  { mmi: 2, color: "#bfccff", label: "II-III (Débil)" },
  { mmi: 4, color: "#80ffff", label: "IV (Ligero)" },
  { mmi: 5, color: "#7aff93", label: "V (Moderado)" },
  { mmi: 6, color: "#ffff00", label: "VI (Fuerte)" },
  { mmi: 7, color: "#ffc800", label: "VII (Muy Fuerte)" },
  { mmi: 8, color: "#ff9100", label: "VIII (Severo)" },
  { mmi: 9, color: "#ff0000", label: "IX (Violento)" },
  { mmi: 10, color: "#c80000", label: "X+ (Extremo)" }
];

export function intensityCssColor(mmiValue: number | null): string {
  if (mmiValue === null) return "#64748b";
  const mmi = Math.round(mmiValue);
  let band = INTENSITY_BANDS[0];
  for (const b of INTENSITY_BANDS) {
    if (mmi >= b.mmi) band = b;
  }
  return band.color;
}

// Codigo ISO2 del pais para la IMAGEN de bandera. (Windows no renderiza los emoji
// de bandera, por eso usamos imagenes.) Redes nacionales -> su pais;
// USGS/EMSC (globales) -> pais al final del lugar ("..., Chile").
const SOURCE_COUNTRY: Record<string, string> = {
  JMA: "jp",
  BMKG: "id",
  IGP: "pe",
  FUNVISIS: "ve",
  SGC: "co",
  IGN: "es",
  SSN: "mx",
  CSN: "cl",
  INGV: "it",
  GEONET: "nz",
  CWA: "tw"
};

const COUNTRY_CODES: [string, string][] = [
  ["chile", "cl"],
  ["argentina", "ar"],
  ["bolivia", "bo"],
  ["peru", "pe"],
  ["ecuador", "ec"],
  ["colombia", "co"],
  ["venezuela", "ve"],
  ["panama", "pa"],
  ["costa rica", "cr"],
  ["nicaragua", "ni"],
  ["el salvador", "sv"],
  ["guatemala", "gt"],
  ["honduras", "hn"],
  ["mexico", "mx"],
  ["méxico", "mx"],
  ["puerto rico", "pr"],
  ["japan", "jp"],
  ["indonesia", "id"],
  ["philippines", "ph"],
  ["taiwan", "tw"],
  ["china", "cn"],
  ["new zealand", "nz"],
  ["papua new guinea", "pg"],
  ["vanuatu", "vu"],
  ["fiji", "fj"],
  ["tonga", "to"],
  ["greece", "gr"],
  ["turkey", "tr"],
  ["türkiye", "tr"],
  ["italy", "it"],
  ["iran", "ir"],
  ["afghanistan", "af"],
  ["pakistan", "pk"],
  ["india", "in"],
  ["nepal", "np"],
  ["russia", "ru"],
  ["alaska", "us"],
  ["california", "us"],
  ["hawaii", "us"],
  ["oregon", "us"],
  ["nevada", "us"],
  ["united states", "us"]
];

export function countryCode(event: SeismicEvent): string | null {
  const bySource = SOURCE_COUNTRY[event.source];
  if (bySource) return bySource;
  const place = getEventPlace(event.title).toLowerCase();
  const tail = place.split(",").pop()?.trim() ?? place;
  for (const [name, code] of COUNTRY_CODES) {
    if (tail.includes(name)) return code;
  }
  for (const [name, code] of COUNTRY_CODES) {
    if (place.includes(name)) return code;
  }
  return null;
}

// Nombre de pais en espanol por ISO2 (gobernanza: el pais siempre en un idioma).
const COUNTRY_NAMES_ES: Record<string, string> = {
  cl: "Chile",
  ar: "Argentina",
  bo: "Bolivia",
  pe: "Perú",
  ec: "Ecuador",
  co: "Colombia",
  ve: "Venezuela",
  py: "Paraguay",
  uy: "Uruguay",
  br: "Brasil",
  pa: "Panamá",
  cr: "Costa Rica",
  ni: "Nicaragua",
  sv: "El Salvador",
  gt: "Guatemala",
  hn: "Honduras",
  bz: "Belice",
  mx: "México",
  cu: "Cuba",
  do: "Rep. Dominicana",
  ht: "Haití",
  jm: "Jamaica",
  pr: "Puerto Rico",
  us: "EE. UU.",
  ca: "Canadá",
  jp: "Japón",
  id: "Indonesia",
  ph: "Filipinas",
  tw: "Taiwán",
  cn: "China",
  kr: "Corea del Sur",
  kp: "Corea del Norte",
  nz: "Nueva Zelanda",
  au: "Australia",
  pg: "Papúa Nueva Guinea",
  vu: "Vanuatu",
  fj: "Fiyi",
  to: "Tonga",
  sb: "Islas Salomón",
  ws: "Samoa",
  gr: "Grecia",
  tr: "Turquía",
  it: "Italia",
  es: "España",
  pt: "Portugal",
  fr: "Francia",
  de: "Alemania",
  ro: "Rumanía",
  bg: "Bulgaria",
  al: "Albania",
  hr: "Croacia",
  rs: "Serbia",
  me: "Montenegro",
  mk: "Macedonia del Norte",
  cy: "Chipre",
  ir: "Irán",
  iq: "Irak",
  af: "Afganistán",
  pk: "Pakistán",
  in: "India",
  np: "Nepal",
  bt: "Bután",
  bd: "Bangladés",
  mm: "Myanmar",
  th: "Tailandia",
  la: "Laos",
  vn: "Vietnam",
  kh: "Camboya",
  my: "Malasia",
  ru: "Rusia",
  ge: "Georgia",
  am: "Armenia",
  az: "Azerbaiyán",
  kz: "Kazajistán",
  kg: "Kirguistán",
  tj: "Tayikistán",
  uz: "Uzbekistán",
  tm: "Turkmenistán",
  ma: "Marruecos",
  dz: "Argelia",
  tn: "Túnez",
  ly: "Libia",
  eg: "Egipto",
  et: "Etiopía",
  ke: "Kenia",
  tz: "Tanzania",
  cd: "R.D. del Congo",
  za: "Sudáfrica",
  is: "Islandia",
  gb: "Reino Unido"
};

export function countryNameEs(code: string | null): string | null {
  if (!code) return null;
  return COUNTRY_NAMES_ES[code] ?? code.toUpperCase();
}

// Lugar normalizado: descriptor de la fuente + pais en espanol, formato unico.
export function normalizedPlace(event: SeismicEvent, code: string | null): string {
  const descriptor = getEventPlace(event.title).trim();
  const country = countryNameEs(code);
  if (!country) return descriptor;
  if (descriptor.toLowerCase().endsWith(country.toLowerCase())) return descriptor;
  return `${descriptor} · ${country}`;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

function romanIntensity(value: number): string {
  const level = Math.max(1, Math.min(12, Math.round(value)));
  return ROMAN[level];
}

// IPE de Allen, Wald & Worden (2012), version distancia de ruptura (Rrup):
//   MMI = c0 + c1·M + c2·log10( sqrt(Rrup² + (1 + c3·e^(M-5))²) )
// El termino (1 + c3·e^(M-5)) es la saturacion cerca de la fuente. Sobre el epicentro
// la distancia de ruptura ≈ la PROFUNDIDAD, asi que un sismo mas profundo => menor MMI.
// Coeficientes (OpenQuake): c0=3.95, c1=0.913, c2=-1.107, c3=0.813.
const IPE = { c0: 3.95, c1: 0.913, c2: -1.107, c3: 0.813 };

// Estima la MMI epicentral (maxima) a partir de magnitud + profundidad. Es una
// estimacion empirica (dispersion ~±0.7 grados), NO una medida.
export function estimatedIntensity(event: SeismicEvent): number | null {
  if (typeof event.magnitude !== "number") return null;
  const m = event.magnitude;
  const rrup = Math.max(1, event.depthKm ?? 10); // km; al epicentro Rrup ≈ profundidad
  const saturation = 1 + IPE.c3 * Math.exp(m - 5);
  // OpenQuake usa np.log (logaritmo natural), NO log10
  const mmi = IPE.c0 + IPE.c1 * m + IPE.c2 * Math.log(Math.sqrt(rrup * rrup + saturation * saturation));
  return Math.max(1, Math.min(12, mmi));
}

// Intensidad unificada y etiquetada por escala (no se mezclan: MMI instrumental/DYFI
// vs shindo de la JMA). Si no hay medida, se ESTIMA con la IPE (marcada como tal).
export function normalizedIntensity(event: SeismicEvent): string {
  if (event.intensityText) return event.intensityText; // p. ej. "JMA 3" (shindo), ya etiquetado
  // Intensidades < I (p. ej. cdi=0 = sin reportes) no son significativas.
  if (typeof event.mmi === "number" && event.mmi >= 1) return `MMI ${romanIntensity(event.mmi)}`;
  if (typeof event.cdi === "number" && event.cdi >= 1) return `MMI ${romanIntensity(event.cdi)} (DYFI)`;
  const estimate = estimatedIntensity(event);
  if (estimate !== null) return `≈ MMI ${romanIntensity(estimate)}`;
  return "Sin dato";
}
