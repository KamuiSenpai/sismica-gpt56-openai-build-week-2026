import { type OperationalSourceCode, type TsunamiProduct } from "@sismica/shared";
import { XMLParser } from "fast-xml-parser";

import { env } from "../config/env.js";
import { fetchXml } from "./http.js";
import { type AuxiliaryProvider } from "./types.js";

type NoaaSource = "NOAA_PTWC" | "NOAA_NTWC";

type CapInfo = {
  event?: string;
  urgency?: string;
  severity?: string;
  certainty?: string;
  onset?: string;
  expires?: string;
  senderName?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  web?: string;
  area?: { areaDesc?: string } | Array<{ areaDesc?: string }>;
};

type CapAlert = {
  identifier?: string;
  sender?: string;
  sent?: string;
  status?: string;
  msgType?: string;
  source?: string;
  info?: CapInfo | CapInfo[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true
});

function isoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseNoaaCap(xml: string, source: NoaaSource, fallbackUrl: string): TsunamiProduct | null {
  const parsed = parser.parse(xml) as { alert?: CapAlert };
  const alert = parsed.alert;
  const identifier = alert?.identifier;
  const sentAtUtc = isoOrNull(alert?.sent);
  if (!identifier || !sentAtUtc) {
    throw new Error(`Invalid ${source} CAP payload`);
  }

  const info = Array.isArray(alert.info) ? alert.info[0] : alert.info;
  if (!info) return null;
  if (!info.event) throw new Error(`Invalid ${source} CAP payload`);

  const areas = Array.isArray(info.area) ? info.area : info.area ? [info.area] : [];
  return {
    productId: `${source}:${identifier}`,
    source,
    identifier,
    center: alert.source ?? info.senderName ?? alert.sender ?? source,
    event: info.event,
    status: alert.status ?? "Unknown",
    messageType: alert.msgType ?? "Unknown",
    urgency: info.urgency ?? null,
    severity: info.severity ?? null,
    certainty: info.certainty ?? null,
    sentAtUtc,
    onsetAtUtc: isoOrNull(info.onset),
    expiresAtUtc: isoOrNull(info.expires),
    headline: info.headline || null,
    description: info.description || null,
    instruction: info.instruction || null,
    areaDescription:
      areas
        .map((area) => area.areaDesc)
        .filter(Boolean)
        .join("; ") || null,
    sourceUrl: info.web || fallbackUrl
  };
}

function createNoaaProvider(code: NoaaSource, url: string): AuxiliaryProvider<TsunamiProduct> {
  return {
    code: code as OperationalSourceCode,
    async fetchItems() {
      const xml = await fetchXml(url);
      const item = parseNoaaCap(xml, code, url);
      return item ? [{ item, rawPayload: xml }] : [];
    }
  };
}

export const noaaPtwcProvider = createNoaaProvider("NOAA_PTWC", env.noaaPtwcCapUrl);
export const noaaNtwcProvider = createNoaaProvider("NOAA_NTWC", env.noaaNtwcCapUrl);
