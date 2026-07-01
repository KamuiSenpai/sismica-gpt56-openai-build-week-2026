import { type Pool } from "pg";

import {
  type ContinentCode,
  type ContinentSeismicPresence,
  type SeismicPresenceSummary,
  type SourceCode
} from "@sismica/shared";

type EventLocationRow = {
  source: SourceCode;
  title: string;
};

type CoverageRow = {
  total_records: number;
  start_year: number | null;
  end_year: number | null;
};

const CONTINENTS: Array<{ code: ContinentCode; name: string }> = [
  { code: "SA", name: "Sudamerica" },
  { code: "NA", name: "Norteamerica" },
  { code: "EU", name: "Europa" },
  { code: "AS", name: "Asia" },
  { code: "OC", name: "Oceania" },
  { code: "AF", name: "Africa" }
];

const COUNTRY_CONTINENT: Record<string, ContinentCode> = {
  ar: "SA",
  bo: "SA",
  br: "SA",
  cl: "SA",
  co: "SA",
  ec: "SA",
  fk: "SA",
  gf: "SA",
  gy: "SA",
  pe: "SA",
  py: "SA",
  sr: "SA",
  uy: "SA",
  ve: "SA",

  ag: "NA",
  ai: "NA",
  aw: "NA",
  bb: "NA",
  bl: "NA",
  bm: "NA",
  bq: "NA",
  bs: "NA",
  bz: "NA",
  ca: "NA",
  cr: "NA",
  cu: "NA",
  cw: "NA",
  dm: "NA",
  do: "NA",
  gd: "NA",
  gl: "NA",
  gp: "NA",
  gt: "NA",
  hn: "NA",
  ht: "NA",
  jm: "NA",
  kn: "NA",
  ky: "NA",
  lc: "NA",
  mf: "NA",
  mq: "NA",
  ms: "NA",
  mx: "NA",
  ni: "NA",
  pa: "NA",
  pm: "NA",
  pr: "NA",
  sv: "NA",
  sx: "NA",
  tc: "NA",
  tt: "NA",
  us: "NA",
  vc: "NA",
  vg: "NA",
  vi: "NA",

  ad: "EU",
  al: "EU",
  at: "EU",
  ax: "EU",
  ba: "EU",
  be: "EU",
  bg: "EU",
  by: "EU",
  ch: "EU",
  cy: "EU",
  cz: "EU",
  de: "EU",
  dk: "EU",
  ee: "EU",
  es: "EU",
  fi: "EU",
  fo: "EU",
  fr: "EU",
  gb: "EU",
  gg: "EU",
  gi: "EU",
  gr: "EU",
  hr: "EU",
  hu: "EU",
  ie: "EU",
  im: "EU",
  is: "EU",
  it: "EU",
  je: "EU",
  li: "EU",
  lt: "EU",
  lu: "EU",
  lv: "EU",
  mc: "EU",
  md: "EU",
  me: "EU",
  mk: "EU",
  mt: "EU",
  nl: "EU",
  no: "EU",
  pl: "EU",
  pt: "EU",
  ro: "EU",
  rs: "EU",
  se: "EU",
  si: "EU",
  sk: "EU",
  sm: "EU",
  ua: "EU",
  va: "EU",
  xk: "EU",

  ae: "AS",
  af: "AS",
  am: "AS",
  az: "AS",
  bd: "AS",
  bh: "AS",
  bn: "AS",
  bt: "AS",
  cn: "AS",
  ge: "AS",
  hk: "AS",
  id: "AS",
  il: "AS",
  in: "AS",
  iq: "AS",
  ir: "AS",
  jo: "AS",
  jp: "AS",
  kg: "AS",
  kh: "AS",
  kp: "AS",
  kr: "AS",
  kw: "AS",
  kz: "AS",
  la: "AS",
  lb: "AS",
  lk: "AS",
  mm: "AS",
  mn: "AS",
  mo: "AS",
  my: "AS",
  np: "AS",
  om: "AS",
  ph: "AS",
  pk: "AS",
  ps: "AS",
  qa: "AS",
  ru: "AS",
  sa: "AS",
  sg: "AS",
  sy: "AS",
  th: "AS",
  tj: "AS",
  tm: "AS",
  tr: "AS",
  tw: "AS",
  uz: "AS",
  vn: "AS",
  ye: "AS",

  au: "OC",
  ck: "OC",
  fj: "OC",
  fm: "OC",
  gu: "OC",
  ki: "OC",
  mh: "OC",
  mp: "OC",
  nc: "OC",
  nf: "OC",
  nr: "OC",
  nu: "OC",
  nz: "OC",
  pf: "OC",
  pg: "OC",
  pn: "OC",
  pw: "OC",
  sb: "OC",
  tk: "OC",
  to: "OC",
  tv: "OC",
  vu: "OC",
  wf: "OC",
  ws: "OC",

  ao: "AF",
  bf: "AF",
  bi: "AF",
  bj: "AF",
  bw: "AF",
  cd: "AF",
  cf: "AF",
  cg: "AF",
  ci: "AF",
  cm: "AF",
  cv: "AF",
  dj: "AF",
  dz: "AF",
  eg: "AF",
  eh: "AF",
  er: "AF",
  et: "AF",
  ga: "AF",
  gh: "AF",
  gm: "AF",
  gn: "AF",
  gq: "AF",
  gw: "AF",
  ke: "AF",
  km: "AF",
  lr: "AF",
  ls: "AF",
  ly: "AF",
  ma: "AF",
  mg: "AF",
  ml: "AF",
  mr: "AF",
  mu: "AF",
  mw: "AF",
  mz: "AF",
  na: "AF",
  ne: "AF",
  ng: "AF",
  re: "AF",
  rw: "AF",
  sc: "AF",
  sd: "AF",
  sh: "AF",
  sl: "AF",
  sn: "AF",
  so: "AF",
  ss: "AF",
  st: "AF",
  sz: "AF",
  td: "AF",
  tg: "AF",
  tn: "AF",
  tz: "AF",
  ug: "AF",
  za: "AF",
  zm: "AF",
  zw: "AF"
};

const COUNTRY_NAMES_ES: Record<string, string> = {
  ar: "Argentina",
  au: "Australia",
  bo: "Bolivia",
  ca: "Canada",
  cl: "Chile",
  cn: "China",
  co: "Colombia",
  cr: "Costa Rica",
  ec: "Ecuador",
  es: "Espana",
  fj: "Fiyi",
  gr: "Grecia",
  gt: "Guatemala",
  hn: "Honduras",
  id: "Indonesia",
  ir: "Iran",
  it: "Italia",
  jp: "Japon",
  mx: "Mexico",
  ni: "Nicaragua",
  nl: "Paises Bajos",
  nz: "Nueva Zelanda",
  pa: "Panama",
  pe: "Peru",
  pg: "Papua Nueva Guinea",
  ph: "Filipinas",
  pr: "Puerto Rico",
  sv: "El Salvador",
  to: "Tonga",
  tr: "Turquia",
  tw: "Taiwan",
  us: "EE. UU.",
  ve: "Venezuela",
  vu: "Vanuatu"
};

const SOURCE_COUNTRY: Partial<Record<SourceCode, string>> = {
  BMKG: "id",
  CSN: "cl",
  CWA: "tw",
  FUNVISIS: "ve",
  GA: "au",
  GEONET: "nz",
  IGEPN: "ec",
  IGP: "pe",
  IGN: "es",
  INGV: "it",
  INPRES: "ar",
  INSIVUMEH: "gt",
  JMA: "jp",
  KNMI: "nl",
  MARN: "sv",
  NCEDC: "us",
  NRCAN: "ca",
  OVSICORI: "cr",
  SCEDC: "us",
  SGC: "co",
  SSN: "mx"
};

const COUNTRY_KEYWORDS: Array<[string, string]> = [
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

function fallbackCountry(source: SourceCode, title: string): string | null {
  const sourceCountry = SOURCE_COUNTRY[source];
  if (sourceCountry) return sourceCountry;
  const lower = title.toLowerCase();
  const tail = lower.split(",").pop()?.trim() ?? lower;
  for (const [keyword, code] of COUNTRY_KEYWORDS) {
    if (tail.includes(keyword)) return code;
  }
  for (const [keyword, code] of COUNTRY_KEYWORDS) {
    if (lower.includes(keyword)) return code;
  }
  return null;
}

function countryName(code: string): string {
  return COUNTRY_NAMES_ES[code] ?? code.toUpperCase();
}

export async function getSeismicPresenceSummary(pool: Pool): Promise<SeismicPresenceSummary> {
  const [coverageResult, result] = await Promise.all([
    pool.query<CoverageRow>(
      `
        SELECT
          COUNT(*)::int AS total_records,
          EXTRACT(YEAR FROM (MIN(event_time_utc) AT TIME ZONE 'UTC'))::int AS start_year,
          EXTRACT(YEAR FROM (MAX(event_time_utc) AT TIME ZONE 'UTC'))::int AS end_year
        FROM seismic_events
      `
    ),
    pool.query<EventLocationRow>(
      `
      SELECT
        source,
        title
      FROM seismic_events
    `
    )
  ]);

  const byContinent = new Map<ContinentCode, Map<string, number>>();
  let assignedRecords = 0;

  for (const row of result.rows) {
    const country = fallbackCountry(row.source, row.title);
    if (!country) continue;
    const continent = COUNTRY_CONTINENT[country];
    if (!continent) continue;
    assignedRecords += 1;
    const countries = byContinent.get(continent) ?? new Map<string, number>();
    countries.set(country, (countries.get(country) ?? 0) + 1);
    byContinent.set(continent, countries);
  }

  const continents: ContinentSeismicPresence[] = CONTINENTS.map(({ code, name }) => {
    const countries = Array.from(byContinent.get(code)?.entries() ?? [])
      .map(([countryCode, count]) => ({
        countryCode,
        countryName: countryName(countryCode),
        count,
        percentage: assignedRecords > 0 ? (count / assignedRecords) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count || a.countryName.localeCompare(b.countryName, "es"))
      .slice(0, 3);

    return {
      continentCode: code,
      continentName: name,
      countries
    };
  });

  const coverage = coverageResult.rows[0];
  const totalRecords = coverage?.total_records ?? result.rows.length;

  return {
    generatedAt: new Date().toISOString(),
    totalRecords,
    assignedRecords,
    unassignedRecords: totalRecords - assignedRecords,
    startYear: coverage?.start_year ?? null,
    endYear: coverage?.end_year ?? null,
    continents
  };
}
