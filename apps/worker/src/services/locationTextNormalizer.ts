import { type SeismicEvent, type SourceCode } from "@sismica/shared";

const BMKG_PREFIX_PATTERN = /^Pusat\s+gempa\s+berada\s+di\s+(?:darat|laut)\s+/iu;
const TITLE_SPLIT_PATTERN =
  /^\s*(?:M\s*)?([+-]?\d+(?:[.,]\d+)?)\s*(?:([\p{L}][\p{L}\s/-]*?))?\s*-\s*(.+)\s*$/iu;
const SPANISH_DIRECTION_PATTERN = /\bal\s+(NNO|NNE|ENE|ESE|SSE|SSO|OSO|ONO|NO|NE|SO|SE|N|S|E|O)\s+de\b/giu;
const TITLE_SMALL_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "da",
  "das",
  "dei",
  "degli",
  "della",
  "delle",
  "di",
  "do",
  "dos",
  "du",
  "of",
  "and",
  "sul"
]);

const BMKG_DIRECTION_PHRASES: Array<[source: string, target: string]> = [
  ["barat laut", "al noroeste de"],
  ["timur laut", "al noreste de"],
  ["barat daya", "al suroeste de"],
  ["tenggara", "al sureste de"],
  ["selatan", "al sur de"],
  ["utara", "al norte de"],
  ["timur", "al este de"],
  ["barat", "al oeste de"]
];

const DIRECT_LOCATION_REPLACEMENTS: Array<[pattern: RegExp, replacement: string]> = [
  [/\bSouth Sandwich Islands\b/giu, "Islas Sandwich del Sur"],
  [/\bPhilippine Islands\b/giu, "Islas Filipinas"],
  [/\bHawaiian Islands\b/giu, "Islas de Hawái"],
  [/\bFiji Islands\b/giu, "Islas Fiyi"],
  [/\bNorth Island Of New Zealand\b/giu, "Isla Norte de Nueva Zelanda"],
  [/\bSouth Island Of New Zealand\b/giu, "Isla Sur de Nueva Zelanda"],
  [/\bMolucca Sea\b/giu, "Mar de Molucas"],
  [/\bEastern Mediterranean Sea\b/giu, "Mar Mediterráneo oriental"],
  [/\bMediterranean Sea\b/giu, "Mar Mediterráneo"],
  [/\bSea Of Okhotsk\b/giu, "Mar de Ojotsk"],
  [/\bBanda Sea\b/giu, "Mar de Banda"],
  [/\bCelebes Sea\b/giu, "Mar de Célebes"],
  [/\bFlores Sea\b/giu, "Mar de Flores"],
  [/\bSavu Sea\b/giu, "Mar de Savu"],
  [/\bMona Passage\b/giu, "Canal de la Mona"],
  [/\bPanama-Colombia Border\b/giu, "frontera entre Panamá y Colombia"],
  [/\bKepulauan Barat Daya\b/giu, "Islas del Suroeste"],
  [/\bCosta Siciliana nord-orientale\b/giu, "costa nororiental de Sicilia"],
  [/\bCosta Siciliana centro-settentrionale\b/giu, "costa centro-septentrional de Sicilia"],
  [/\bCosta Ligure Occidentale\b/giu, "costa occidental de Liguria"],
  [/\bNorth Island\b/giu, "Isla Norte"],
  [/\bSouth Island\b/giu, "Isla Sur"],
  [/\bU\.?\s*S\.?\s*Virgin Islands\b/giu, "Islas Vírgenes de EE. UU."],
  [/\bBosnia\s+And\s+Herzegovina\b/giu, "Bosnia y Herzegovina"],
  [/\bDominican Republic\b/giu, "República Dominicana"],
  [/\bUnited States\b/giu, "Estados Unidos"],
  [/\bNew Zealand\b/giu, "Nueva Zelanda"],
  [/\bNew Mexico\b/giu, "Nuevo México"],
  [/\bN\.?\s*Z\.?\b/giu, "Nueva Zelanda"],
  [/\bPapua\b/giu, "Papúa"],
  [/\bPeru\b/giu, "Perú"],
  [/\bMexico\b/giu, "México"],
  [/\bPhilippines\b/giu, "Filipinas"],
  [/\bTaiwan\b/giu, "Taiwán"],
  [/\bTurkey\b/giu, "Turquía"],
  [/\bTajikistan\b/giu, "Tayikistán"],
  [/\bFiji\b/giu, "Fiyi"],
  [/\bHawaii\b/giu, "Hawái"],
  [/\bIceland\b/giu, "Islandia"],
  [/\bJapan\b/giu, "Japón"],
  [/\bGreece\b/giu, "Grecia"],
  [/\bRomania\b/giu, "Rumanía"],
  [/\bAfghanistan\b/giu, "Afganistán"],
  [/\bXizang\b/giu, "Tíbet"]
];

const REGION_DIRECTION_MAP: Record<string, string> = {
  north: "norte",
  northern: "norte",
  south: "sur",
  southern: "sur",
  east: "este",
  eastern: "este",
  west: "oeste",
  western: "oeste",
  northeast: "noreste",
  northeastern: "noreste",
  northwest: "noroeste",
  northwestern: "noroeste",
  southeast: "sureste",
  southeastern: "sureste",
  southwest: "suroeste",
  southwestern: "suroeste",
  central: "central"
};

const COMPASS_LABEL_MAP: Record<string, string> = {
  n: "norte",
  north: "norte",
  s: "sur",
  south: "sur",
  e: "este",
  east: "este",
  w: "oeste",
  west: "oeste",
  ne: "noreste",
  northeast: "noreste",
  nw: "noroeste",
  northwest: "noroeste",
  se: "sureste",
  southeast: "sureste",
  sw: "suroeste",
  southwest: "suroeste",
  nne: "norte-noreste",
  northnortheast: "norte-noreste",
  ene: "este-noreste",
  eastnortheast: "este-noreste",
  ese: "este-sureste",
  eastsoutheast: "este-sureste",
  sse: "sur-sureste",
  southsoutheast: "sur-sureste",
  ssw: "sur-suroeste",
  southsouthwest: "sur-suroeste",
  wsw: "oeste-suroeste",
  westsouthwest: "oeste-suroeste",
  wnw: "oeste-noroeste",
  westnorthwest: "oeste-noroeste",
  nnw: "norte-noroeste",
  northnorthwest: "norte-noroeste"
};

const SPANISH_DIRECTION_LABELS: Record<string, string> = {
  n: "norte",
  s: "sur",
  e: "este",
  o: "oeste",
  ne: "noreste",
  no: "noroeste",
  se: "sureste",
  so: "suroeste",
  sse: "sur-sureste",
  sso: "sur-suroeste",
  ene: "este-noreste",
  ese: "este-sureste",
  nne: "norte-noreste",
  nno: "norte-noroeste",
  ono: "oeste-noroeste",
  oso: "oeste-suroeste"
};

const TITLE_QUALIFIER_MAP: Record<string, string> = {
  blast: "explosión",
  explosion: "explosión",
  "quarry blast": "explosión"
};

const ITALIAN_PROVINCE_MAP: Record<string, string> = {
  AN: "Ancona",
  AV: "Avellino",
  MC: "Macerata"
};

const IGN_SUFFIX_MAP: Record<string, string> = {
  CO: "Córdoba",
  FRA: "Francia",
  MA: "Málaga",
  POR: "Portugal"
};

const TRAILING_REGION_CODE_MAP: Record<string, string> = {
  AGS: "Aguascalientes",
  AK: "Alaska",
  AL: "Alabama",
  AR: "Arkansas",
  AZ: "Arizona",
  BC: "Baja California",
  BCS: "Baja California Sur",
  CA: "California",
  CAM: "Campeche",
  CDMX: "Ciudad de México",
  CHIH: "Chihuahua",
  CHIS: "Chiapas",
  CO: "Colorado",
  COAH: "Coahuila",
  COL: "Colima",
  CT: "Connecticut",
  DC: "Distrito de Columbia",
  DE: "Delaware",
  DGO: "Durango",
  FL: "Florida",
  GA: "Georgia",
  GRO: "Guerrero",
  GTO: "Guanajuato",
  HI: "Hawái",
  HGO: "Hidalgo",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  JAL: "Jalisco",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Luisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MEX: "Estado de México",
  MI: "Michigan",
  MICH: "Michoacán",
  MN: "Minnesota",
  MO: "Misuri",
  MOR: "Morelos",
  MS: "Misisipi",
  MT: "Montana",
  NC: "Carolina del Norte",
  ND: "Dakota del Norte",
  NE: "Nebraska",
  NH: "Nuevo Hampshire",
  NJ: "Nueva Jersey",
  NL: "Nuevo León",
  NM: "Nuevo México",
  NV: "Nevada",
  NY: "Nueva York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregón",
  OAX: "Oaxaca",
  PA: "Pensilvania",
  PR: "Puerto Rico",
  PUE: "Puebla",
  QRO: "Querétaro",
  QROO: "Quintana Roo",
  RI: "Rhode Island",
  SC: "Carolina del Sur",
  SD: "Dakota del Sur",
  SIN: "Sinaloa",
  SLP: "San Luis Potosí",
  SON: "Sonora",
  TAB: "Tabasco",
  TAMPS: "Tamaulipas",
  TLAX: "Tlaxcala",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VER: "Veracruz",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "Virginia Occidental",
  WY: "Wyoming",
  YUC: "Yucatán",
  ZAC: "Zacatecas"
};

function normalizeSpaces(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[;,]+$/u, "")
    .replace(/(?<=[\p{Ll}\p{N})])\.+$/u, "");
}

function titleCase(text: string): string {
  const titled = text
    .toLocaleLowerCase("es")
    .replace(
      /(^|[\s,./\-(])(\p{L})/gu,
      (_match, separator: string, letter: string) => separator + letter.toLocaleUpperCase("es")
    );

  return titled
    .split(" ")
    .map((part, index) => {
      const bare = part.replace(/^[^\p{L}]*/u, "").replace(/[^\p{L}]+$/u, "");
      if (!bare) return part;
      const lower = bare.toLocaleLowerCase("es");
      if (index > 0 && TITLE_SMALL_WORDS.has(lower)) {
        return part.replace(bare, lower);
      }
      return part;
    })
    .join(" ");
}

function restoreKnownAbbreviations(text: string): string {
  return text.replace(/Ee\.\s*Uu\./gu, "EE. UU.");
}

function normalizeRegionCodeKey(value: string): string {
  return value.toLocaleUpperCase("en").replace(/[^A-Z]/g, "");
}

function replaceRegionCode(value: string, map: Record<string, string>): string | null {
  return map[normalizeRegionCodeKey(value)] ?? null;
}

function expandRegionalCodes(text: string): string {
  return text
    .replace(/\(([^()]{2,5})\)/gu, (match, code: string) => {
      const label = replaceRegionCode(code, ITALIAN_PROVINCE_MAP);
      return label ? `(${label})` : match;
    })
    .replace(/\.([A-Za-z]{2,4})\b/gu, (match, code: string) => {
      const label = replaceRegionCode(code, IGN_SUFFIX_MAP);
      return label ? `, ${label}` : match;
    })
    .replace(/,\s*([A-Za-z]{2,5})\b/gu, (match, code: string) => {
      const label = replaceRegionCode(code, TRAILING_REGION_CODE_MAP);
      return label ? `, ${label}` : match;
    });
}

function beautifyDescriptor(text: string): string {
  const compact = expandRegionalCodes(
    normalizeSpaces(text)
      .replace(/\s*,\s*/g, ", ")
      .replace(/^the\s+/iu, "")
  );
  const hasLower = /\p{Ll}/u.test(compact);
  const hasUpper = /\p{Lu}/u.test(compact);
  if (!hasLower && hasUpper) return restoreKnownAbbreviations(expandRegionalCodes(titleCase(compact)));
  return restoreKnownAbbreviations(
    expandRegionalCodes(
      compact.replace(/\b[\p{Lu}]{2,}(?:\s+[\p{Lu}]{2,})*\b/gu, (match) => titleCase(match))
    )
  );
}

function normalizeDirectionKey(value: string): string {
  return value
    .toLocaleLowerCase("en")
    .replace(/\./g, "")
    .replace(/[^a-z]/g, "");
}

function compassLabel(value: string): string | null {
  return COMPASS_LABEL_MAP[normalizeDirectionKey(value)] ?? null;
}

function regionLabel(value: string): string | null {
  return REGION_DIRECTION_MAP[normalizeDirectionKey(value)] ?? null;
}

function normalizeSpanishDirections(text: string): string {
  return text.replace(SPANISH_DIRECTION_PATTERN, (_match, rawDirection: string) => {
    const direction = SPANISH_DIRECTION_LABELS[rawDirection.toLocaleLowerCase("es")] ?? rawDirection;
    return `al ${direction} de`;
  });
}

function replaceIndonesianArchipelagoNames(text: string): string {
  return text.replace(/\bKepulauan\s+([\p{L}\s'-]+)\b/giu, (_match, region: string) => {
    return `Islas ${normalizeSpaces(region)}`;
  });
}

function applyDirectLocationReplacements(text: string): string {
  let normalized = text;
  for (const [pattern, replacement] of DIRECT_LOCATION_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = replaceIndonesianArchipelagoNames(normalized);
  normalized = normalized.replace(/\b([\p{L}\s'-]+?)\s+Peninsula\b/giu, (_match, region: string) => {
    return `península de ${normalizeSpaces(region)}`;
  });

  return normalized;
}

function normalizeGenericLocationText(text: string): string {
  const compact = normalizeSpaces(text);
  if (!compact) return "Región sin nombre";

  const normalizedAbbreviations = expandRegionalCodes(
    compact
      .replace(/^the\s+/iu, "")
      .replace(/\bN\.\s+Coast\b/giu, "North Coast")
      .replace(/\bS\.\s+Coast\b/giu, "South Coast")
      .replace(/\bE\.\s+Coast\b/giu, "East Coast")
      .replace(/\bW\.\s+Coast\b/giu, "West Coast")
      .replace(/\bN\.\s+Island\b/giu, "North Island")
      .replace(/\bS\.\s+Island\b/giu, "South Island")
  );

  const translatedBase = normalizeSpanishDirections(applyDirectLocationReplacements(normalizedAbbreviations));

  const eventNearMatch = translatedBase.match(/^Event of magnitude [^,]+,\s*near\s+(.+)$/iu);
  if (eventNearMatch) {
    return beautifyDescriptor(`cerca de ${normalizeGenericLocationText(eventNearMatch[1])}`);
  }

  const distanceMatch = translatedBase.match(/^(\d+(?:[.,]\d+)?)\s*km\s+([A-Za-z.-]+)\s+of\s+(.+)$/iu);
  if (distanceMatch) {
    const [, distance, direction, place] = distanceMatch;
    const label = compassLabel(direction);
    if (label) {
      return beautifyDescriptor(`${distance} km al ${label} de ${normalizeGenericLocationText(place)}`);
    }
  }

  const distanceFromMatch = translatedBase.match(/^(\d+(?:[.,]\d+)?)\s*km\s+([A-Za-z.-]+)\s+from\s+(.+)$/iu);
  if (distanceFromMatch) {
    const [, distance, direction, place] = distanceFromMatch;
    const label = compassLabel(direction);
    if (label) {
      return beautifyDescriptor(`${distance} km al ${label} de ${normalizeGenericLocationText(place)}`);
    }
  }

  const distanceCompactDirectionMatch = translatedBase.match(
    /^(\d+(?:[.,]\d+)?)\s*km\s+([A-Za-z.-]+)\s+(.+)$/iu
  );
  if (distanceCompactDirectionMatch) {
    const [, distance, direction, place] = distanceCompactDirectionMatch;
    const label = compassLabel(direction);
    if (label && !/^of\s+/iu.test(place)) {
      return beautifyDescriptor(`${distance} km al ${label} de ${normalizeGenericLocationText(place)}`);
    }
  }

  const nearDirectionalCoastMatch = translatedBase.match(
    /^Near\s+(?:the\s+)?([A-Za-z.-]+)\s+Coast\s+of\s+(.+)$/iu
  );
  if (nearDirectionalCoastMatch) {
    const [, direction, place] = nearDirectionalCoastMatch;
    const label = compassLabel(direction);
    if (label) {
      return beautifyDescriptor(`cerca de la costa ${label} de ${normalizeGenericLocationText(place)}`);
    }
  }

  const offDirectionalCoastMatch = translatedBase.match(
    /^Off\s+(?:the\s+)?([A-Za-z.-]+)\s+Coast\s+of\s+(.+)$/iu
  );
  if (offDirectionalCoastMatch) {
    const [, direction, place] = offDirectionalCoastMatch;
    const label = compassLabel(direction);
    if (label) {
      return beautifyDescriptor(`frente a la costa ${label} de ${normalizeGenericLocationText(place)}`);
    }
  }

  const nearCoastMatch = translatedBase.match(/^Near\s+(?:the\s+)?Coast\s+of\s+(.+)$/iu);
  if (nearCoastMatch) {
    const place = nearCoastMatch[1];
    const coastalRegionMatch = place.match(
      /^(North|Northern|South|Southern|East|Eastern|West|Western|Northeast|Northwestern|Southeast|Southwestern|Central)\s+(.+)$/iu
    );
    if (coastalRegionMatch) {
      const label = regionLabel(coastalRegionMatch[1]);
      if (label) {
        return beautifyDescriptor(
          `cerca de la costa ${label} de ${normalizeGenericLocationText(coastalRegionMatch[2])}`
        );
      }
    }
    return beautifyDescriptor(`cerca de la costa de ${normalizeGenericLocationText(place)}`);
  }

  const offCoastMatch = translatedBase.match(/^Off\s+(?:the\s+)?Coast\s+of\s+(.+)$/iu);
  if (offCoastMatch) {
    const place = offCoastMatch[1];
    const coastalRegionMatch = place.match(
      /^(North|Northern|South|Southern|East|Eastern|West|Western|Northeast|Northwestern|Southeast|Southwestern|Central)\s+(.+)$/iu
    );
    if (coastalRegionMatch) {
      const label = regionLabel(coastalRegionMatch[1]);
      if (label) {
        return beautifyDescriptor(
          `frente a la costa ${label} de ${normalizeGenericLocationText(coastalRegionMatch[2])}`
        );
      }
    }
    return beautifyDescriptor(`frente a la costa de ${normalizeGenericLocationText(place)}`);
  }

  const offshoreMatch = translatedBase.match(/^Offshore\s+(.+)$/iu);
  if (offshoreMatch) {
    return beautifyDescriptor(`frente a la costa de ${normalizeGenericLocationText(offshoreMatch[1])}`);
  }

  const relativeDirectionMatch = translatedBase.match(/^([A-Za-z.-]+)\s+of\s+(.+)$/iu);
  if (relativeDirectionMatch) {
    const [, direction, place] = relativeDirectionMatch;
    const label = compassLabel(direction);
    if (label) {
      return beautifyDescriptor(`al ${label} de ${normalizeGenericLocationText(place)}`);
    }
  }

  const leadingDirectionMatch = translatedBase.match(/^([A-Za-z.-]+)\s+(.+)$/iu);
  if (leadingDirectionMatch) {
    const [, direction, place] = leadingDirectionMatch;
    const label = compassLabel(direction);
    if (label) {
      return beautifyDescriptor(`al ${label} de ${normalizeGenericLocationText(place)}`);
    }
  }

  const prefectureMatch = translatedBase.match(/^(.+?)\s+Prefecture$/iu);
  if (prefectureMatch) {
    return beautifyDescriptor(`la prefectura de ${normalizeGenericLocationText(prefectureMatch[1])}`);
  }

  const countyHallMatch = translatedBase.match(/^(.+?)\s+County Hall$/iu);
  if (countyHallMatch) {
    return beautifyDescriptor(`la sede del condado de ${normalizeGenericLocationText(countyHallMatch[1])}`);
  }

  const regionSuffixMatch = translatedBase.match(/^(.+?)\s+region(?:,\s*(.+))?$/iu);
  if (regionSuffixMatch) {
    const place = normalizeGenericLocationText(regionSuffixMatch[1]);
    const country = regionSuffixMatch[2] ? `, ${normalizeGenericLocationText(regionSuffixMatch[2])}` : "";
    return beautifyDescriptor(`región de ${place}${country}`);
  }

  const regionalMatch = translatedBase.match(
    /^(North|Northern|South|Southern|East|Eastern|West|Western|Northeast|Northwestern|Southeast|Southwestern|Central)\s+(.+)$/iu
  );
  if (regionalMatch) {
    const [, direction, place] = regionalMatch;
    const label = regionLabel(direction);
    if (label === "central") {
      return beautifyDescriptor(`centro de ${normalizeGenericLocationText(place)}`);
    }
    if (label) {
      return beautifyDescriptor(`${label} de ${normalizeGenericLocationText(place)}`);
    }
  }

  const nearMatch = translatedBase.match(/^Near\s+(.+)$/iu);
  if (nearMatch) {
    return beautifyDescriptor(`cerca de ${normalizeGenericLocationText(nearMatch[1])}`);
  }

  return beautifyDescriptor(translatedBase);
}

export function normalizeBmkgLocationText(text: string): string {
  const compact = normalizeSpaces(text);
  if (!compact) return "Indonesia";

  const withoutPrefix = compact.replace(BMKG_PREFIX_PATTERN, "");
  const distanceMatch = withoutPrefix.match(/^(\d+(?:[.,]\d+)?)\s*km\s+(.+)$/iu);
  if (!distanceMatch) return beautifyDescriptor(withoutPrefix);

  const [, distance, directionAndPlace] = distanceMatch;
  const normalizedDirectionAndPlace = normalizeSpaces(directionAndPlace);

  for (const [sourceDirection, targetDirection] of BMKG_DIRECTION_PHRASES) {
    const directionPattern = new RegExp(`^${sourceDirection.replace(/\s+/g, "\\s+")}\\s+(.+)$`, "iu");
    const directionMatch = normalizedDirectionAndPlace.match(directionPattern);
    if (directionMatch) {
      return beautifyDescriptor(`${distance} km ${targetDirection} ${directionMatch[1]}`);
    }
  }

  return beautifyDescriptor(withoutPrefix);
}

function normalizeTitleQualifier(qualifier: string | undefined): string | null {
  if (!qualifier) return null;
  const normalized = normalizeSpaces(qualifier).toLocaleLowerCase("en");
  return TITLE_QUALIFIER_MAP[normalized] ?? null;
}

export function normalizeSourceLocationText(source: SourceCode, text: string): string {
  switch (source) {
    case "BMKG":
      return normalizeBmkgLocationText(text);
    default:
      return normalizeGenericLocationText(text);
  }
}

export function normalizeSourceTitleText(
  source: SourceCode,
  title: string,
  magnitude?: number | null
): string {
  const compact = normalizeSpaces(title);
  if (!compact) return magnitude === null || magnitude === undefined ? "Sismo" : `M${magnitude.toFixed(1)}`;

  const match = compact.match(TITLE_SPLIT_PATTERN);
  if (!match) {
    return normalizeSourceLocationText(source, compact);
  }

  const normalizedMagnitude = magnitude ?? Number.parseFloat(match[1].replace(",", "."));
  const magnitudeLabel = Number.isFinite(normalizedMagnitude)
    ? `M${normalizedMagnitude.toFixed(1)}`
    : "Sismo";
  const normalizedLocation = normalizeSourceLocationText(source, match[3]);
  const qualifier = normalizeTitleQualifier(match[2]);
  if (qualifier) {
    return `${magnitudeLabel} - ${qualifier}: ${normalizedLocation}`;
  }
  return `${magnitudeLabel} - ${normalizedLocation}`;
}

export function normalizeSeismicEventText(event: SeismicEvent): SeismicEvent {
  return {
    ...event,
    title: normalizeSourceTitleText(event.source, event.title, event.magnitude)
  };
}
