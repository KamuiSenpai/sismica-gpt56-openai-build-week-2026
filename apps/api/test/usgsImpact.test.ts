import assert from "node:assert/strict";
import test from "node:test";

import type { SeismicEvent } from "@sismica/shared";

import {
  selectPagerCities,
  UsgsImpactService,
  UsgsImpactUnavailableError
} from "../src/services/usgsImpactService.js";

const DETAIL_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=ustest&format=geojson";
const CITIES_URL = "https://earthquake.usgs.gov/product/losspager/ustest/cities.json";
const PAGER_XML_URL = "https://earthquake.usgs.gov/product/losspager/ustest/pager.xml";
const MMI_URL = "https://earthquake.usgs.gov/product/shakemap/ustest/cont_mi.json";
const PGA_URL = "https://earthquake.usgs.gov/product/shakemap/ustest/cont_pga.json";
const PGV_URL = "https://earthquake.usgs.gov/product/shakemap/ustest/cont_pgv.json";
const DYFI_URL = "https://earthquake.usgs.gov/product/dyfi/ustest/dyfi_geo_10km.geojson";

function seismicEvent(overrides: Partial<SeismicEvent> = {}): SeismicEvent {
  return {
    eventId: "USGS:ustest",
    source: "USGS",
    sourceEventId: "ustest",
    title: "Evento de prueba",
    magnitude: 6,
    magnitudeType: "mww",
    latitude: -12,
    longitude: -77,
    depthKm: 20,
    mmi: null,
    cdi: null,
    intensityText: null,
    stationCount: null,
    azimuthalGapDeg: null,
    nearestStationDeg: null,
    rmsSec: null,
    significance: null,
    feltReports: null,
    alertLevel: null,
    tsunami: false,
    networkCode: "us",
    providerEventCode: "test",
    eventType: "earthquake",
    detailUrl: DETAIL_URL,
    sources: ["USGS"],
    sourceCount: 1,
    eventTimeUtc: "2026-07-18T12:00:00.000Z",
    updatedAtUtc: "2026-07-18T12:05:00.000Z",
    status: "reviewed",
    sourceUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/ustest",
    ingestedAt: "2026-07-18T12:06:00.000Z",
    ...overrides
  };
}

function response(value: unknown, contentType = "application/json"): Response {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function serviceWithResponses(responses: Map<string, Response>, requests: string[] = []): UsgsImpactService {
  return new UsgsImpactService({
    fetchImpl: async (url) => {
      requests.push(url);
      const found = responses.get(url);
      if (!found) return new Response("Not found", { status: 404 });
      return found.clone();
    },
    timeoutMs: 2000,
    cacheTtlMs: 60000,
    maxDocumentBytes: 1000000,
    maxGeoJsonBytes: 1000000,
    now: () => new Date("2026-07-18T13:00:00.000Z")
  });
}

function officialDetail(): unknown {
  return {
    properties: {
      products: {
        losspager: [
          {
            status: "UPDATE",
            updateTime: Date.parse("2026-07-18T12:10:00.000Z"),
            properties: { alertlevel: "yellow", maxmmi: "7.2" },
            contents: {
              "pager.xml": { url: PAGER_XML_URL },
              "cities.json": { url: CITIES_URL }
            }
          }
        ],
        shakemap: [
          {
            status: "UPDATE",
            updateTime: Date.parse("2026-07-18T12:09:00.000Z"),
            properties: { "review-status": "reviewed" },
            contents: {
              "download/cont_mi.json": { url: MMI_URL },
              "download/cont_pga.json": { url: PGA_URL },
              "download/cont_pgv.json": { url: PGV_URL }
            }
          }
        ],
        dyfi: [
          {
            status: "UPDATE",
            updateTime: Date.parse("2026-07-18T12:08:00.000Z"),
            properties: { "num-responses": "42", maxmmi: "5.4" },
            contents: { "dyfi_geo_10km.geojson": { url: DYFI_URL } }
          }
        ]
      }
    }
  };
}

test("selecciona hasta ocho ciudades PAGER y respeta primero las publicadas en el mapa", () => {
  const cities = selectPagerCities([
    { name: "Publicada B", lat: 2, lon: 2, pop: 100, mmi: 3, on_map: 1 },
    { name: "Publicada A", lat: 1, lon: 1, pop: 50, mmi: 2, on_map: 1 },
    ...Array.from({ length: 10 }, (_, index) => ({
      name: `Ciudad ${index}`,
      lat: index,
      lon: -index,
      pop: 1000 - index,
      mmi: 9 - index * 0.2,
      on_map: 0
    }))
  ]);

  assert.equal(cities.length, 8);
  assert.deepEqual(
    cities.slice(0, 2).map((city) => city.name),
    ["Publicada B", "Publicada A"]
  );
  assert.equal(cities[2].name, "Ciudad 0");
  assert.equal(cities[2].intensityRoman, "IX");
});

test("normaliza PAGER, ShakeMap y DYFI desde productos oficiales y cachea GeoJSON", async () => {
  const requests: string[] = [];
  const geoJson = { type: "FeatureCollection", features: [] };
  const service = serviceWithResponses(
    new Map([
      [DETAIL_URL, response(officialDetail())],
      [
        CITIES_URL,
        response({ all_cities: [{ name: "Lima", lat: -12.04, lon: -77.03, pop: 9752000, mmi: 6.7 }] })
      ],
      [PGA_URL, response(geoJson, "application/geo+json")]
    ]),
    requests
  );

  const summary = await service.getSummary(seismicEvent());
  assert.equal(summary.generatedAtUtc, "2026-07-18T13:00:00.000Z");
  assert.equal(summary.pager?.cities[0].name, "Lima");
  assert.equal(summary.pager?.alertLevel, "yellow");
  assert.equal(summary.shakeMap?.layers.pga?.unit, "% g");
  assert.equal(summary.shakeMap?.layers.pgv?.unit, "cm/s");
  assert.equal(summary.dyfi?.responseCount, 42);
  assert.equal(summary.dyfi?.layer.aggregationKm, 10);

  await service.getGeoJson(seismicEvent(), "pga");
  await service.getGeoJson(seismicEvent(), "pga");
  assert.equal(requests.filter((url) => url === DETAIL_URL).length, 1);
  assert.equal(requests.filter((url) => url === PGA_URL).length, 1);
});

test("usa pager.xml como respaldo cuando el producto no publica cities.json", async () => {
  const detail = officialDetail() as {
    properties: { products: { losspager: Array<{ contents: Record<string, unknown> }> } };
  };
  delete detail.properties.products.losspager[0].contents["cities.json"];
  const service = serviceWithResponses(
    new Map([
      [DETAIL_URL, response(detail)],
      [
        PAGER_XML_URL,
        response(
          '<pager><city name="Callao" lat="-12.05" lon="-77.12" population="500000" mmi="5.6"/></pager>',
          "application/xml"
        )
      ]
    ])
  );

  const summary = await service.getSummary(seismicEvent());
  assert.equal(summary.pager?.cities[0].name, "Callao");
  assert.equal(summary.pager?.cities[0].intensityRoman, "VI");
});

test("no consulta URLs externas ni habilita PAGER sin XML oficial", async () => {
  let calls = 0;
  const blocked = serviceWithResponses(new Map(), []);
  await assert.rejects(
    blocked.getSummary(seismicEvent({ detailUrl: "https://example.com/event.json" })),
    UsgsImpactUnavailableError
  );

  const detail = officialDetail() as {
    properties: { products: { losspager: Array<{ contents: Record<string, unknown> }> } };
  };
  detail.properties.products.losspager[0].contents = { "cities.json": { url: CITIES_URL } };
  const service = new UsgsImpactService({
    fetchImpl: async (url) => {
      calls += 1;
      return response(url === DETAIL_URL ? detail : { all_cities: [] });
    },
    timeoutMs: 2000,
    cacheTtlMs: 60000,
    maxDocumentBytes: 1000000,
    maxGeoJsonBytes: 1000000
  });
  const summary = await service.getSummary(seismicEvent());
  assert.equal(summary.pager, null);
  assert.equal(calls, 1);
});
