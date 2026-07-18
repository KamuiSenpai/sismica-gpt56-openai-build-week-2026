import type {
  OfficialDyfiSummary,
  OfficialGeoJsonLayer,
  OfficialImpactLayerKind,
  OfficialImpactSummary,
  OfficialPagerCity,
  OfficialPagerSummary,
  OfficialShakeMapSummary,
  SeismicEvent
} from "@sismica/shared";
import { XMLParser } from "fast-xml-parser";
import { LRUCache } from "lru-cache";

const USGS_HOST = "earthquake.usgs.gov";
const MAX_PAGER_CITIES = 8;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type UsgsContent = {
  url?: unknown;
};

type UsgsProduct = {
  status?: unknown;
  updateTime?: unknown;
  properties?: unknown;
  contents?: unknown;
};

type ImpactRecord = {
  summary: OfficialImpactSummary;
  layerUrls: Partial<Record<OfficialImpactLayerKind, string>>;
};

type GeoJsonRecord = {
  data: unknown;
  size: number;
};

export type UsgsImpactServiceOptions = {
  fetchImpl?: FetchLike;
  timeoutMs: number;
  cacheTtlMs: number;
  maxDocumentBytes: number;
  maxGeoJsonBytes: number;
  now?: () => Date;
};

export class UsgsImpactUnavailableError extends Error {}
export class UsgsImpactLayerNotFoundError extends Error {}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed !== null && parsed >= 0 ? Math.trunc(parsed) : null;
}

function updatedAtUtc(product: UsgsProduct): string | null {
  const timestamp = asNumber(product.updateTime);
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function productProperties(product: UsgsProduct): Record<string, unknown> {
  return asRecord(product.properties) ?? {};
}

function productContents(product: UsgsProduct): Record<string, UsgsContent> {
  const contents = asRecord(product.contents);
  if (!contents) return {};
  return Object.fromEntries(
    Object.entries(contents).filter((entry): entry is [string, UsgsContent] => asRecord(entry[1]) !== null)
  );
}

function preferredProduct(value: unknown): UsgsProduct | null {
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    const product = asRecord(candidate) as UsgsProduct | null;
    if (!product) continue;
    if (asString(product.status)?.toUpperCase() === "DELETE") continue;
    if (updatedAtUtc(product) === null) continue;
    return product;
  }
  return null;
}

function contentUrl(product: UsgsProduct, names: readonly string[]): string | null {
  const contents = productContents(product);
  for (const name of names) {
    const url = asString(contents[name]?.url);
    if (url && isAllowedUsgsUrl(url)) return url;
  }
  return null;
}

function hasContent(product: UsgsProduct, names: readonly string[]): boolean {
  const contents = productContents(product);
  return names.some((name) => Boolean(contents[name]));
}

function productPageUrl(event: SeismicEvent, product: "pager" | "shakemap" | "dyfi"): string {
  return `https://${USGS_HOST}/earthquakes/eventpage/${encodeURIComponent(event.sourceEventId)}/${product}`;
}

export function isAllowedUsgsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === USGS_HOST;
  } catch {
    return false;
  }
}

export function mmiToRoman(value: number): string {
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const index = Math.min(10, Math.max(1, Math.round(value))) - 1;
  return numerals[index];
}

type PagerCityCandidate = OfficialPagerCity & {
  onMap: boolean;
  sourceIndex: number;
};

function normalizePagerCity(value: unknown, sourceIndex: number): PagerCityCandidate | null {
  const city = asRecord(value);
  if (!city) return null;
  const name = asString(city.name);
  const latitude = asNumber(city.lat ?? city.latitude);
  const longitude = asNumber(city.lon ?? city.longitude);
  const population = asNumber(city.pop ?? city.population);
  const mmi = asNumber(city.mmi);
  if (
    !name ||
    latitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude === null ||
    longitude < -180 ||
    longitude > 180 ||
    population === null ||
    population < 0 ||
    mmi === null ||
    mmi < 1 ||
    mmi > 10
  ) {
    return null;
  }

  return {
    name,
    latitude,
    longitude,
    population: Math.round(population),
    mmi: Number(mmi.toFixed(1)),
    intensityRoman: mmiToRoman(mmi),
    onMap: city.on_map === 1 || city.on_map === "1" || city.onMap === true,
    sourceIndex
  };
}

export function selectPagerCities(values: readonly unknown[]): OfficialPagerCity[] {
  const candidates = values
    .map((value, index) => normalizePagerCity(value, index))
    .filter((city): city is PagerCityCandidate => city !== null);
  const published = candidates
    .filter((city) => city.onMap)
    .sort((left, right) => left.sourceIndex - right.sourceIndex);
  const remaining = candidates
    .filter((city) => !city.onMap)
    .sort(
      (left, right) =>
        right.mmi - left.mmi ||
        right.population - left.population ||
        left.name.localeCompare(right.name, "es")
    );

  return [...published, ...remaining]
    .slice(0, MAX_PAGER_CITIES)
    .map(({ onMap: _onMap, sourceIndex: _index, ...city }) => city);
}

function findXmlCityNodes(value: unknown, result: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) findXmlCityNodes(item, result);
    return result;
  }
  const record = asRecord(value);
  if (!record) return result;
  if (
    asString(record.name) &&
    (record.lat !== undefined || record.latitude !== undefined) &&
    (record.lon !== undefined || record.longitude !== undefined) &&
    record.mmi !== undefined
  ) {
    result.push(record);
  }
  for (const nested of Object.values(record)) findXmlCityNodes(nested, result);
  return result;
}

function parsePagerXml(xml: string): OfficialPagerCity[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    trimValues: true
  });
  return selectPagerCities(findXmlCityNodes(parser.parse(xml)));
}

function parsePagerCitiesJson(value: unknown): OfficialPagerCity[] {
  const record = asRecord(value);
  return selectPagerCities(Array.isArray(record?.all_cities) ? record.all_cities : []);
}

function layerEndpoint(eventId: string, kind: OfficialImpactLayerKind): string {
  return `/api/events/${encodeURIComponent(eventId)}/official-impact/${kind}`;
}

function createLayer(
  eventId: string,
  kind: OfficialImpactLayerKind,
  unit: OfficialGeoJsonLayer["unit"],
  aggregationKm: number | null,
  updatedAt: string
): OfficialGeoJsonLayer {
  return { kind, unit, aggregationKm, endpoint: layerEndpoint(eventId, kind), updatedAtUtc: updatedAt };
}

function isFeatureCollection(value: unknown): boolean {
  const record = asRecord(value);
  return record?.type === "FeatureCollection" && Array.isArray(record.features);
}

export class UsgsImpactService {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxDocumentBytes: number;
  private readonly maxGeoJsonBytes: number;
  private readonly now: () => Date;
  private readonly impactCache: LRUCache<string, ImpactRecord>;
  private readonly geoJsonCache: LRUCache<string, GeoJsonRecord>;

  constructor(options: UsgsImpactServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = boundedInteger(options.timeoutMs, 1000, 30000);
    this.maxDocumentBytes = boundedInteger(options.maxDocumentBytes, 100000, 10000000);
    this.maxGeoJsonBytes = boundedInteger(options.maxGeoJsonBytes, 100000, 25000000);
    this.now = options.now ?? (() => new Date());
    const ttl = boundedInteger(options.cacheTtlMs, 10000, 900000);
    this.impactCache = new LRUCache({ max: 100, ttl });
    this.geoJsonCache = new LRUCache({
      maxSize: 60000000,
      sizeCalculation: (record) => record.size,
      ttl
    });
  }

  async getSummary(event: SeismicEvent): Promise<OfficialImpactSummary> {
    return (await this.getRecord(event)).summary;
  }

  async getGeoJson(event: SeismicEvent, layer: OfficialImpactLayerKind): Promise<unknown> {
    const record = await this.getRecord(event);
    const url = record.layerUrls[layer];
    if (!url) throw new UsgsImpactLayerNotFoundError(`La capa oficial ${layer} no esta disponible`);
    const cached = this.geoJsonCache.get(url);
    if (cached) return cached.data;

    const text = await this.fetchText(url, this.maxGeoJsonBytes, "application/geo+json, application/json");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new UsgsImpactUnavailableError(`USGS devolvio GeoJSON invalido para ${layer}`);
    }
    if (!isFeatureCollection(data)) {
      throw new UsgsImpactUnavailableError(`USGS devolvio un contrato GeoJSON no compatible para ${layer}`);
    }
    this.geoJsonCache.set(url, { data, size: Buffer.byteLength(text) });
    return data;
  }

  private cacheKey(event: SeismicEvent): string {
    return `${event.eventId}:${event.updatedAtUtc ?? event.ingestedAt}`;
  }

  private async getRecord(event: SeismicEvent): Promise<ImpactRecord> {
    const key = this.cacheKey(event);
    const cached = this.impactCache.get(key);
    if (cached) return cached;
    if (event.source !== "USGS" || !event.detailUrl || !isAllowedUsgsUrl(event.detailUrl)) {
      throw new UsgsImpactUnavailableError("El evento no contiene un detalle oficial USGS utilizable");
    }

    const detail = this.parseJson(
      await this.fetchText(event.detailUrl, this.maxDocumentBytes, "application/geo+json, application/json"),
      "detalle del evento"
    );
    const products = asRecord(asRecord(asRecord(detail)?.properties)?.products);
    if (!products) throw new UsgsImpactUnavailableError("El detalle USGS no contiene productos asociados");

    const layerUrls: Partial<Record<OfficialImpactLayerKind, string>> = {};
    const pagerProduct = preferredProduct(products.losspager);
    const shakeMapProduct = preferredProduct(products.shakemap);
    const dyfiProduct = preferredProduct(products.dyfi);

    const pager = pagerProduct ? await this.buildPager(event, pagerProduct).catch(() => null) : null;
    const shakeMap = shakeMapProduct ? this.buildShakeMap(event, shakeMapProduct, layerUrls) : null;
    const dyfi = dyfiProduct ? this.buildDyfi(event, dyfiProduct, layerUrls) : null;
    const record: ImpactRecord = {
      summary: {
        eventId: event.eventId,
        generatedAtUtc: this.now().toISOString(),
        pager,
        shakeMap,
        dyfi
      },
      layerUrls
    };
    this.impactCache.set(key, record);
    return record;
  }

  private async buildPager(event: SeismicEvent, product: UsgsProduct): Promise<OfficialPagerSummary | null> {
    if (!hasContent(product, ["pager.xml", "exposure.xml"])) return null;
    const updatedAt = updatedAtUtc(product);
    if (!updatedAt) return null;

    let cities: OfficialPagerCity[] = [];
    const citiesUrl = contentUrl(product, ["json/cities.json", "cities.json"]);
    if (citiesUrl) {
      try {
        const data = this.parseJson(
          await this.fetchText(citiesUrl, this.maxDocumentBytes, "application/json"),
          "ciudades PAGER"
        );
        cities = parsePagerCitiesJson(data);
      } catch {
        cities = [];
      }
    }
    if (cities.length === 0) {
      const xmlUrl = contentUrl(product, ["pager.xml", "exposure.xml"]);
      if (xmlUrl) {
        cities = parsePagerXml(
          await this.fetchText(xmlUrl, this.maxDocumentBytes, "application/xml, text/xml")
        );
      }
    }
    if (cities.length === 0) return null;

    const properties = productProperties(product);
    return {
      source: "USGS PAGER",
      sourceUrl: productPageUrl(event, "pager"),
      updatedAtUtc: updatedAt,
      alertLevel: asString(properties.alertlevel),
      maxMmi: asNumber(properties.maxmmi),
      cities
    };
  }

  private buildShakeMap(
    event: SeismicEvent,
    product: UsgsProduct,
    layerUrls: Partial<Record<OfficialImpactLayerKind, string>>
  ): OfficialShakeMapSummary | null {
    const updatedAt = updatedAtUtc(product);
    if (!updatedAt) return null;
    const definitions = [
      {
        kind: "mmi" as const,
        names: ["download/cont_mi.json", "download/cont_mmi.json"],
        unit: "MMI" as const
      },
      { kind: "pga" as const, names: ["download/cont_pga.json"], unit: "% g" as const },
      { kind: "pgv" as const, names: ["download/cont_pgv.json"], unit: "cm/s" as const }
    ];
    const layers: OfficialShakeMapSummary["layers"] = {};
    for (const definition of definitions) {
      const url = contentUrl(product, definition.names);
      if (!url) continue;
      layerUrls[definition.kind] = url;
      layers[definition.kind] = createLayer(event.eventId, definition.kind, definition.unit, null, updatedAt);
    }
    if (Object.keys(layers).length === 0) return null;

    return {
      source: "USGS ShakeMap",
      sourceUrl: productPageUrl(event, "shakemap"),
      updatedAtUtc: updatedAt,
      reviewStatus: asString(productProperties(product)["review-status"]),
      layers
    };
  }

  private buildDyfi(
    event: SeismicEvent,
    product: UsgsProduct,
    layerUrls: Partial<Record<OfficialImpactLayerKind, string>>
  ): OfficialDyfiSummary | null {
    const updatedAt = updatedAtUtc(product);
    if (!updatedAt) return null;
    const tenKmUrl = contentUrl(product, ["dyfi_geo_10km.geojson"]);
    const oneKmUrl = contentUrl(product, ["dyfi_geo_1km.geojson"]);
    const url = tenKmUrl ?? oneKmUrl;
    if (!url) return null;
    const aggregationKm = tenKmUrl ? 10 : 1;
    layerUrls.dyfi = url;
    const properties = productProperties(product);

    return {
      source: "USGS DYFI",
      sourceUrl: productPageUrl(event, "dyfi"),
      updatedAtUtc: updatedAt,
      responseCount: asNonNegativeInteger(properties["num-responses"] ?? properties.numResp),
      maxCdi: asNumber(properties.maxmmi),
      layer: createLayer(event.eventId, "dyfi", "CDI", aggregationKm, updatedAt)
    };
  }

  private parseJson(text: string, label: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new UsgsImpactUnavailableError(`USGS devolvio JSON invalido para ${label}`);
    }
  }

  private async fetchText(url: string, maximumBytes: number, accept: string): Promise<string> {
    if (!isAllowedUsgsUrl(url)) throw new UsgsImpactUnavailableError("URL USGS no permitida");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: accept, "User-Agent": "sismica-official-impact/1.0" }
      });
      const finalUrl = response.url || url;
      if (!isAllowedUsgsUrl(finalUrl)) {
        throw new UsgsImpactUnavailableError("USGS redirigio a un host no permitido");
      }
      if (!response.ok) {
        throw new UsgsImpactUnavailableError(`USGS respondio HTTP ${response.status}`);
      }
      const declaredLength = asNumber(response.headers.get("content-length"));
      if (declaredLength !== null && declaredLength > maximumBytes) {
        throw new UsgsImpactUnavailableError("El producto USGS excede el limite permitido");
      }
      if (!response.body) return "";

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let total = 0;
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumBytes) {
          await reader.cancel();
          throw new UsgsImpactUnavailableError("El producto USGS excede el limite permitido");
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } catch (error) {
      if (error instanceof UsgsImpactUnavailableError) throw error;
      const reason = error instanceof Error ? error.message : "fallo remoto";
      throw new UsgsImpactUnavailableError(`No se pudo consultar USGS: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
