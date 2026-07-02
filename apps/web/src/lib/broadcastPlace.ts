import { type SeismicEvent } from "@sismica/shared";

import { countryCode, countryNameEs, getEventPlace } from "./presentation";

const FULL_COUNTRY_OVERRIDES: Record<string, string> = {
  us: "Estados Unidos"
};

const DIRECT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bMolucca Sea\b/giu, "Mar de Molucas"],
  [/\b(?:Ceram|Seram) Sea\b/giu, "Mar de Ceram"],
  [/\bSunda Strait\b/giu, "Estrecho de Sonda"],
  [/\bCook Strait\b/giu, "Estrecho de Cook"],
  [/\bSea of Okhotsk\b/giu, "Mar de Ojotsk"],
  [/\bBanda Sea\b/giu, "Mar de Banda"],
  [/\bCelebes Sea\b/giu, "Mar de Celebes"],
  [/\bFlores Sea\b/giu, "Mar de Flores"],
  [/\bSavu Sea\b/giu, "Mar de Savu"],
  [/\bEastern Mediterranean Sea\b/giu, "Mar Mediterraneo oriental"],
  [/\bMediterranean Sea\b/giu, "Mar Mediterraneo"],
  [/\bPoland\b/giu, "Polonia"],
  [/\bBonin Islands\b/giu, "Islas Bonin"],
  [/\bColombia-Ecuador Border\b/giu, "frontera entre Colombia y Ecuador"],
  [/\bCrete\b/giu, "Creta"],
  [/\bGreece\b/giu, "Grecia"],
  [/\bPapua\b/giu, "Papua"],
  [/\bPeru\b/giu, "Peru"],
  [/\bMexico\b/giu, "Mexico"],
  [/\bPhilippines\b/giu, "Filipinas"],
  [/\bTaiwan\b/giu, "Taiwan"],
  [/\bTurkey\b/giu, "Turquia"],
  [/\bJapan\b/giu, "Japon"],
  [/\bIndonesia\b/giu, "Indonesia"],
  [/\bUnited States\b/giu, "Estados Unidos"],
  [/\bU\.?\s*S\.?\s*Virgin Islands\b/giu, "Islas Virgenes de EE. UU."],
  [/\bEE\.?\s*UU\.?\b/giu, "Estados Unidos"],
  [/\bEEUU\b/giu, "Estados Unidos"]
];

const COMPASS_LABELS: Record<string, string> = {
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

const REGION_LABELS: Record<string, string> = {
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

const ISO_COUNTRY_LABELS: Record<string, string> = {
  ar: "Argentina",
  cl: "Chile",
  co: "Colombia",
  cr: "Costa Rica",
  ec: "Ecuador",
  es: "Espana",
  gt: "Guatemala",
  id: "Indonesia",
  it: "Italia",
  jp: "Japon",
  mx: "Mexico",
  pe: "Peru",
  pl: "Polonia",
  sv: "El Salvador",
  tr: "Turquia",
  tw: "Taiwan",
  us: "Estados Unidos"
};

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function canonicalLocationPart(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function dedupeLocationParts(text: string): string {
  const seen = new Set<string>();
  return text
    .split(/\s*,\s*|\s*-\s+(?=\p{L})/u)
    .map((part) => normalizeSpaces(part))
    .filter(Boolean)
    .filter((part) => {
      const key = canonicalLocationPart(part);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

function titleCase(text: string): string {
  return text
    .toLocaleLowerCase("es")
    .replace(
      /(^|[\s,./\-(])(\p{L})/gu,
      (_match, separator: string, letter: string) => separator + letter.toLocaleUpperCase("es")
    );
}

function capitalize(text: string): string {
  return text.replace(/^(\p{L})/u, (letter) => letter.toLocaleUpperCase("es"));
}

function decapitalize(text: string): string {
  return text.replace(/^(\p{L})/u, (letter) => letter.toLocaleLowerCase("es"));
}

function beautify(text: string): string {
  const normalized = normalizeSpaces(
    text
      .replace(/\s*-\s*/gu, " - ")
      .replace(/\s*,\s*/gu, ", ")
      .replace(/\s{2,}/gu, " ")
      .replace(/\s+([,.-])/gu, "$1")
      .replace(/([,.-])\s+([,.-])/gu, "$1")
      .replace(/(^\s*[,.-]\s*|\s*[,.-]\s*$)/gu, "")
  );
  const hasLower = /\p{Ll}/u.test(normalized);
  const hasUpper = /\p{Lu}/u.test(normalized);
  return capitalize(!hasLower && hasUpper ? titleCase(normalized) : normalized);
}

export function broadcastCountryName(code: string | null): string | null {
  if (!code) return null;
  return FULL_COUNTRY_OVERRIDES[code] ?? countryNameEs(code);
}

function compassLabel(value: string): string | null {
  const normalized = value
    .toLocaleLowerCase("en")
    .replace(/\./gu, "")
    .replace(/[^a-z]/gu, "");
  return COMPASS_LABELS[normalized] ?? null;
}

function regionLabel(value: string): string | null {
  const normalized = value
    .toLocaleLowerCase("en")
    .replace(/\./gu, "")
    .replace(/[^a-z]/gu, "");
  return REGION_LABELS[normalized] ?? null;
}

function applyDirectReplacements(text: string): string {
  let normalized = text;
  for (const [pattern, replacement] of DIRECT_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function replaceTrailingIsoCountry(text: string): string {
  const match = text.match(/^(.*?)(?:\s*[-,]\s*)([A-Z]{2})$/u);
  if (!match) return text;
  const base = normalizeSpaces(match[1]);
  const label = ISO_COUNTRY_LABELS[match[2].toLocaleLowerCase("en")];
  if (!label) return text;
  if (!base) return label;
  return base.toLocaleLowerCase("es") === label.toLocaleLowerCase("es") ? label : `${base}, ${label}`;
}

function replaceTrailingNamedCountry(text: string): string {
  const match = text.match(/^(.*?)(?:\s*-\s*)([\p{L}. ]+)$/u);
  if (!match) return text;
  const base = normalizeSpaces(match[1]);
  const tail = normalizeSpaces(match[2]).toLocaleLowerCase("es");
  const label =
    Object.values(ISO_COUNTRY_LABELS).find((value) => value.toLocaleLowerCase("es") === tail) ??
    (tail === "ee. uu." ? "Estados Unidos" : null);
  if (!label) return text;
  if (!base) return label;
  return base.toLocaleLowerCase("es") === label.toLocaleLowerCase("es") ? label : `${base}, ${label}`;
}

function appendCountry(descriptor: string, country: string | null): string {
  if (!country) return descriptor;
  const canonicalDescriptor = canonicalLocationPart(descriptor);
  const canonicalCountry = canonicalLocationPart(country);
  if (
    canonicalDescriptor === canonicalCountry ||
    canonicalDescriptor.startsWith(`${canonicalCountry} `) ||
    canonicalDescriptor.endsWith(` ${canonicalCountry}`) ||
    canonicalDescriptor.includes(` ${canonicalCountry} `)
  ) {
    return descriptor;
  }
  return `${descriptor}, ${country}`;
}

function normalizeBroadcastDescriptor(raw: string, depth = 0): string {
  const text = replaceTrailingNamedCountry(
    replaceTrailingIsoCountry(applyDirectReplacements(normalizeSpaces(raw)))
  );
  if (!text || depth > 4) return beautify(text);

  const regionSuffixMatch = text.match(/^(.+?)\s+region$/iu);
  if (regionSuffixMatch) {
    const place = normalizeBroadcastDescriptor(regionSuffixMatch[1], depth + 1);
    return beautify(`region de ${decapitalize(place)}`);
  }

  const distanceMatch = text.match(/^(\d+(?:[.,]\d+)?)\s*km\s+([A-Za-z.-]+)\s+(?:of|from)\s+(.+)$/iu);
  if (distanceMatch) {
    const [, distance, direction, place] = distanceMatch;
    const label = compassLabel(direction);
    if (label)
      return beautify(`${distance} km al ${label} de ${normalizeBroadcastDescriptor(place, depth + 1)}`);
  }

  const compactDistanceMatch = text.match(/^(\d+(?:[.,]\d+)?)\s*km\s+([A-Za-z.-]+)\s+(.+)$/iu);
  if (compactDistanceMatch) {
    const [, distance, direction, place] = compactDistanceMatch;
    const label = compassLabel(direction);
    if (label && !/^(?:coast|offshore)\b/iu.test(place)) {
      return beautify(`${distance} km al ${label} de ${normalizeBroadcastDescriptor(place, depth + 1)}`);
    }
  }

  const nearDirectionalCoastMatch = text.match(/^Near\s+(?:the\s+)?([A-Za-z.-]+)\s+Coast\s+of\s+(.+)$/iu);
  if (nearDirectionalCoastMatch) {
    const [, direction, place] = nearDirectionalCoastMatch;
    const label = compassLabel(direction);
    if (label) {
      return beautify(`cerca de la costa ${label} de ${normalizeBroadcastDescriptor(place, depth + 1)}`);
    }
  }

  const offDirectionalCoastMatch = text.match(/^Off\s+(?:the\s+)?([A-Za-z.-]+)\s+Coast\s+of\s+(.+)$/iu);
  if (offDirectionalCoastMatch) {
    const [, direction, place] = offDirectionalCoastMatch;
    const label = compassLabel(direction);
    if (label) {
      return beautify(`frente a la costa ${label} de ${normalizeBroadcastDescriptor(place, depth + 1)}`);
    }
  }

  const nearCoastMatch = text.match(/^Near\s+(?:the\s+)?Coast\s+of\s+(.+)$/iu);
  if (nearCoastMatch) {
    const place = nearCoastMatch[1];
    const coastalRegionMatch = place.match(
      /^(North|Northern|South|Southern|East|Eastern|West|Western|Northeast|Northwestern|Southeast|Southwestern|Central)\s+(.+)$/iu
    );
    if (coastalRegionMatch) {
      const label = regionLabel(coastalRegionMatch[1]);
      if (label)
        return beautify(
          `cerca de la costa ${label} de ${normalizeBroadcastDescriptor(coastalRegionMatch[2], depth + 1)}`
        );
    }
    return beautify(`cerca de la costa de ${normalizeBroadcastDescriptor(place, depth + 1)}`);
  }

  const offCoastMatch = text.match(/^Off\s+(?:the\s+)?Coast\s+of\s+(.+)$/iu);
  if (offCoastMatch) {
    const place = offCoastMatch[1];
    const coastalRegionMatch = place.match(
      /^(North|Northern|South|Southern|East|Eastern|West|Western|Northeast|Northwestern|Southeast|Southwestern|Central)\s+(.+)$/iu
    );
    if (coastalRegionMatch) {
      const label = regionLabel(coastalRegionMatch[1]);
      if (label)
        return beautify(
          `frente a la costa ${label} de ${normalizeBroadcastDescriptor(coastalRegionMatch[2], depth + 1)}`
        );
    }
    return beautify(`frente a la costa de ${normalizeBroadcastDescriptor(place, depth + 1)}`);
  }

  const offshoreMatch = text.match(/^Offshore\s+(.+)$/iu);
  if (offshoreMatch) {
    return beautify(`frente a la costa de ${normalizeBroadcastDescriptor(offshoreMatch[1], depth + 1)}`);
  }

  const relativeDirectionMatch = text.match(/^([A-Za-z.-]+)\s+of\s+(.+)$/iu);
  if (relativeDirectionMatch) {
    const [, direction, place] = relativeDirectionMatch;
    const label = compassLabel(direction);
    if (label) return beautify(`al ${label} de ${normalizeBroadcastDescriptor(place, depth + 1)}`);
  }

  const regionalMatch = text.match(
    /^(North|Northern|South|Southern|East|Eastern|West|Western|Northeast|Northwestern|Southeast|Southwestern|Central)\s+(.+)$/iu
  );
  if (regionalMatch) {
    const [, direction, place] = regionalMatch;
    const label = regionLabel(direction);
    if (label === "central") return beautify(`centro de ${normalizeBroadcastDescriptor(place, depth + 1)}`);
    if (label) return beautify(`${label} de ${normalizeBroadcastDescriptor(place, depth + 1)}`);
  }

  return beautify(text);
}

export function broadcastPlace(event: SeismicEvent): string {
  const descriptor = normalizeBroadcastDescriptor(getEventPlace(event.title));
  return dedupeLocationParts(appendCountry(descriptor, broadcastCountryName(countryCode(event))));
}
