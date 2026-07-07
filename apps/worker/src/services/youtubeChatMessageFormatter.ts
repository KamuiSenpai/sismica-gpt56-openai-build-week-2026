import { type SeismicEvent } from "@sismica/shared";

const EVENT_TITLE_PREFIX = /^(?:M\s*\d+(?:\.\d+)?|Earthquake|Sismo)\s*(?:-\s*)?/i;
const MAX_CHAT_MESSAGE_LENGTH = 180;
const MAJOR_EARTHQUAKE_MAGNITUDE = 6;

const COUNTRY_TRANSLATIONS: Record<string, string> = {
  argentina: "Argentina",
  bolivia: "Bolivia",
  canada: "Canada",
  chile: "Chile",
  china: "China",
  colombia: "Colombia",
  costa_rica: "Costa Rica",
  dominican_republic: "Republica Dominicana",
  ecuador: "Ecuador",
  "el salvador": "El Salvador",
  espana: "Espana",
  france: "Francia",
  guatemala: "Guatemala",
  indonesia: "Indonesia",
  italy: "Italia",
  japan: "Japon",
  mexico: "Mexico",
  "new zealand": "Nueva Zelanda",
  peru: "Peru",
  philippines: "Filipinas",
  puerto_rico: "Puerto Rico",
  taiwan: "Taiwan",
  turkey: "Turquia",
  "united states": "EE. UU.",
  venezuela: "Venezuela"
};

const SEA_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bMolucca Sea\b/giu, "Mar de Molucas"],
  [/\bSea of Okhotsk\b/giu, "Mar de Ojotsk"],
  [/\bBanda Sea\b/giu, "Mar de Banda"],
  [/\bCelebes Sea\b/giu, "Mar de Celebes"],
  [/\bFlores Sea\b/giu, "Mar de Flores"],
  [/\bSavu Sea\b/giu, "Mar de Savu"],
  [/\bCeram Sea\b/giu, "Mar de Ceram"],
  [/\bSeram Sea\b/giu, "Mar de Ceram"]
];

const DIRECTION_MAP: Record<string, string> = {
  N: "norte",
  S: "sur",
  E: "este",
  W: "oeste",
  NE: "noreste",
  NW: "noroeste",
  SE: "sureste",
  SW: "suroeste",
  NNE: "norte-noreste",
  NNW: "norte-noroeste",
  ENE: "este-noreste",
  ESE: "este-sureste",
  SSE: "sur-sureste",
  SSW: "sur-suroeste",
  WSW: "oeste-suroeste",
  WNW: "oeste-noroeste"
};

const COUNTRY_FLAG_RULES = [
  { keys: ["argentina"], flag: "🇦🇷" },
  { keys: ["bolivia"], flag: "🇧🇴" },
  { keys: ["canada"], flag: "🇨🇦" },
  { keys: ["chile"], flag: "🇨🇱" },
  { keys: ["china"], flag: "🇨🇳" },
  { keys: ["colombia"], flag: "🇨🇴" },
  { keys: ["costa rica"], flag: "🇨🇷" },
  { keys: ["ecuador"], flag: "🇪🇨" },
  { keys: ["el salvador"], flag: "🇸🇻" },
  { keys: ["espana", "spain"], flag: "🇪🇸" },
  { keys: ["francia", "france"], flag: "🇫🇷" },
  { keys: ["guatemala"], flag: "🇬🇹" },
  { keys: ["indonesia"], flag: "🇮🇩" },
  { keys: ["italia", "italy"], flag: "🇮🇹" },
  { keys: ["japon", "japan"], flag: "🇯🇵" },
  { keys: ["mexico"], flag: "🇲🇽" },
  { keys: ["nueva zelanda", "new zealand"], flag: "🇳🇿" },
  { keys: ["peru"], flag: "🇵🇪" },
  { keys: ["filipinas", "philippines"], flag: "🇵🇭" },
  { keys: ["puerto rico"], flag: "🇵🇷" },
  { keys: ["republica dominicana", "dominican republic"], flag: "🇩🇴" },
  { keys: ["taiwan"], flag: "🇹🇼" },
  { keys: ["turquia", "turkey"], flag: "🇹🇷" },
  { keys: ["ee uu", "united states", "estados unidos"], flag: "🇺🇸" },
  { keys: ["venezuela"], flag: "🇻🇪" }
] as const;

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s,./\-(])([a-z])/g, (_match, sep: string, ch: string) => sep + ch.toUpperCase());
}

function cleanDescriptor(text: string): string {
  const withoutSuffix = text.replace(/\.[A-Z]{2,3}$/u, "").trim();
  const hasLower = /[a-z]/u.test(withoutSuffix);
  const hasUpper = /[A-Z]/u.test(withoutSuffix);
  return !hasLower && hasUpper ? titleCase(withoutSuffix) : withoutSuffix;
}

function capitalizeLeadingLetter(text: string): string {
  return text.replace(/^([A-Za-z])/u, (match) => match.toUpperCase());
}

function normalizeLookup(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[.,]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function getEventPlace(title: string): string {
  let stripped = title.replace(EVENT_TITLE_PREFIX, "");
  stripped = stripped.replace(/\b(?:earthquake|sismo)\b/giu, "");
  stripped = stripped.replace(/\s+/gu, " ");
  stripped = stripped.replace(/\s+([,-])/gu, "$1");
  stripped = stripped.replace(/(^\s*[,.-]\s*|\s*[,.-]\s*$)/gu, "");
  return capitalizeLeadingLetter(cleanDescriptor(stripped.trim()) || title);
}

function translateTrailingCountry(text: string): string {
  const lastComma = text.lastIndexOf(",");
  if (lastComma === -1) return text;
  const head = text.slice(0, lastComma).trim();
  const tail = normalizeLookup(text.slice(lastComma + 1));

  const normalizedTail = tail.replace(/ /gu, "_");
  const translated = COUNTRY_TRANSLATIONS[normalizedTail] ?? COUNTRY_TRANSLATIONS[tail];
  return translated ? `${head}, ${translated}` : text;
}

function normalizeDirectionToken(token: string): string {
  return DIRECTION_MAP[token.toUpperCase()] ?? token.toLowerCase();
}

function beautify(text: string): string {
  let value = text.trim();
  for (const [pattern, replacement] of SEA_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return capitalizeLeadingLetter(translateTrailingCountry(value).replace(/\s+/gu, " ").trim());
}

function detectCountryFlag(place: string): string | null {
  const normalized = normalizeLookup(place);
  const matches = COUNTRY_FLAG_RULES.filter((rule) => rule.keys.some((key) => normalized.includes(key)));
  if (matches.length !== 1) return null;
  return matches[0]?.flag ?? null;
}

function buildChatHeading(event: Pick<SeismicEvent, "magnitude" | "title">): string {
  const place = formatBroadcastPlaceForChat(event.title);
  const isMajor = typeof event.magnitude === "number" && event.magnitude >= MAJOR_EARTHQUAKE_MAGNITUDE;
  const prefix = `${isMajor ? "🚨" : ""}🌎${detectCountryFlag(place) ?? ""}`;
  const label = isMajor ? "[TERREMOTO]" : "[NUEVO SISMO]";
  return `${prefix} ${label}`;
}

export function formatBroadcastPlaceForChat(title: string): string {
  const place = getEventPlace(title);

  const offshoreMatch = place.match(/^Offshore\s+(.+)$/iu);
  if (offshoreMatch) return beautify(`Frente a la costa de ${offshoreMatch[1]}`);

  const offCoastMatch = place.match(/^Off Coast of\s+(.+)$/iu);
  if (offCoastMatch) return beautify(`Frente a la costa de ${offCoastMatch[1]}`);

  const nearCoastMatch = place.match(/^Near Coast of\s+(.+)$/iu);
  if (nearCoastMatch) return beautify(`Cerca de la costa de ${nearCoastMatch[1]}`);

  const distanceMatch = place.match(/^(\d+(?:[.,]\d+)?)\s*km\s+([A-Z]{1,3})\s+of\s+(.+)$/iu);
  if (distanceMatch) {
    return beautify(
      `${distanceMatch[1]} km al ${normalizeDirectionToken(distanceMatch[2])} de ${distanceMatch[3]}`
    );
  }

  return beautify(place);
}

function formatMagnitude(value: number | null): string {
  return typeof value === "number" ? `M${value.toFixed(1)}` : "M?";
}

function formatDepth(depthKm: number | null): string | null {
  return typeof depthKm === "number" ? `${Math.round(depthKm)} km` : null;
}

function trimToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, Math.max(0, maxLength - 3)).trimEnd();
  return `${truncated}...`;
}

export function buildNewEventYoutubeChatMessage(
  event: SeismicEvent,
  maxLength = MAX_CHAT_MESSAGE_LENGTH
): string {
  const place = formatBroadcastPlaceForChat(event.title);
  const heading = buildChatHeading(event);
  const base = [`${heading} ${formatMagnitude(event.magnitude)}`, place];
  const withDepth = formatDepth(event.depthKm);
  const withSource = event.source ? `Fuente: ${event.source}` : null;

  const candidates = [
    [...base, withDepth, withSource].filter((value): value is string => Boolean(value)).join(" | "),
    [...base, withSource].filter((value): value is string => Boolean(value)).join(" | "),
    [...base, withDepth].filter((value): value is string => Boolean(value)).join(" | "),
    base.join(" | ")
  ];

  for (const candidate of candidates) {
    if (candidate.length <= maxLength) return candidate;
  }

  const prefix = `${heading} ${formatMagnitude(event.magnitude)} | `;
  const remaining = Math.max(16, maxLength - prefix.length);
  return `${prefix}${trimToLength(place, remaining)}`;
}

export function isEventFreshForYoutubeChat(
  event: Pick<SeismicEvent, "eventTimeUtc">,
  now = Date.now(),
  maxAgeMinutes = 20
): boolean {
  const eventTime = Date.parse(event.eventTimeUtc);
  if (!Number.isFinite(eventTime)) return false;
  return now - eventTime <= maxAgeMinutes * 60_000;
}
