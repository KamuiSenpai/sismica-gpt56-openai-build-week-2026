import assert from "node:assert/strict";
import test from "node:test";

import { normalizeUsgsFeature } from "@sismica/shared";

import {
  buildBmkgSourceEventId,
  mergeBmkgRecords,
  normalizeBmkgRecord
} from "../src/providers/bmkgProvider.js";
import { buildCwaSourceEventId, normalizeCwaRecord } from "../src/providers/cwaProvider.js";
import { normalizeEmscFeature } from "../src/providers/emscProvider.js";
import { normalizeFunvisisFeature } from "../src/providers/funvisisProvider.js";
import { normalizeGdacsFeature } from "../src/providers/gdacsProvider.js";
import { normalizeGeoNetFeature } from "../src/providers/geoNetProvider.js";
import { normalizeGeofonRecord, parseFdsnText } from "../src/providers/geofonProvider.js";
import { normalizeIgpRecord } from "../src/providers/igpProvider.js";
import { consolidateJmaRecords, normalizeJmaRecord } from "../src/providers/jmaProvider.js";
import { parseNoaaCap } from "../src/providers/noaaProvider.js";
import { isAssociationCandidate, sourcePriority } from "../src/services/eventAssociationService.js";

const INGESTED_AT = "2026-06-30T06:00:00.000Z";

test("normaliza parametros tecnicos USGS", () => {
  const event = normalizeUsgsFeature(
    {
      id: "us-test",
      properties: {
        mag: 5.2,
        magType: "mww",
        place: "10 km al sur de prueba",
        time: Date.parse("2026-06-30T05:00:00Z"),
        updated: Date.parse("2026-06-30T05:05:00Z"),
        status: "reviewed",
        nst: 42,
        gap: 71,
        dmin: 1.25,
        rms: 0.63,
        sig: 416,
        felt: 18,
        mmi: 4.1,
        cdi: 3.2,
        tsunami: 1,
        alert: "green"
      },
      geometry: { coordinates: [-77.1, -12.1, 35] }
    },
    INGESTED_AT
  );

  assert.equal(event.stationCount, 42);
  assert.equal(event.azimuthalGapDeg, 71);
  assert.equal(event.nearestStationDeg, 1.25);
  assert.equal(event.rmsSec, 0.63);
  assert.equal(event.mmi, 4.1);
  assert.equal(event.cdi, 3.2);
  assert.equal(event.tsunami, true);
});

test("normaliza evento EMSC", () => {
  const event = normalizeEmscFeature(
    {
      geometry: { coordinates: [-72, -15, 30] },
      properties: {
        unid: "20260630_1",
        time: "2026-06-30T05:30:00Z",
        lastupdate: "2026-06-30T05:31:00Z",
        flynn_region: "SOUTHERN PERU",
        lat: -15,
        lon: -72,
        depth: 30,
        mag: 4.4,
        magtype: "mb",
        auth: "EMSC"
      }
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.source, "EMSC");
  assert.equal(event.magnitude, 4.4);
  assert.equal(event.title, "M4.4 - SOUTHERN PERU");
});

test("parsea y normaliza respuesta FDSN texto de GEOFON", () => {
  const payload = [
    "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType",
    "gfz2026test|2026-06-30T05:20:30.12|-15.20|-72.40|35.0|GFZ||GFZ|gfz2026test|mb|4.60||Southern Peru|earthquake",
    "# comentario final"
  ].join("\n");
  const records = parseFdsnText(payload);
  const event = normalizeGeofonRecord(records[0], INGESTED_AT);

  assert.equal(records.length, 1);
  assert.ok(event);
  assert.equal(event.source, "GEOFON");
  assert.equal(event.eventTimeUtc, "2026-06-30T05:20:30.120Z");
  assert.equal(event.magnitude, 4.6);
  assert.equal(event.depthKm, 35);
});

test("normaliza GeoNet y descarta registros eliminados", () => {
  const active = normalizeGeoNetFeature(
    {
      geometry: { type: "Point", coordinates: [174.8, -41.2] },
      properties: {
        publicID: "2026p-test",
        time: "2026-06-30T05:40:00.000Z",
        depth: 18.5,
        magnitude: 4.2,
        mmi: 3,
        locality: "20 km north of Wellington",
        quality: "best"
      }
    },
    INGESTED_AT
  );
  const deleted = normalizeGeoNetFeature(
    {
      geometry: { type: "Point", coordinates: [174.8, -41.2] },
      properties: {
        publicID: "2026p-deleted",
        time: "2026-06-30T05:40:00.000Z",
        quality: "deleted"
      }
    },
    INGESTED_AT
  );

  assert.ok(active);
  assert.equal(active.source, "GEONET");
  assert.equal(active.mmi, 3);
  assert.equal(active.status, "best");
  assert.equal(deleted, null);
});

test("normaliza evento oficial BMKG con intensidad y sin falso tsunami", () => {
  const event = normalizeBmkgRecord(
    {
      DateTime: "2026-06-30T04:46:45+00:00",
      Coordinates: "1.15,128.20",
      Magnitude: "3.5",
      Kedalaman: "12 km",
      Wilayah: "Pusat gempa berada di laut 20 km Timur Halmahera",
      Potensi: "Tidak berpotensi tsunami",
      Dirasakan: "II-III Kab. Halmahera Timur"
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.source, "BMKG");
  assert.equal(event.latitude, 1.15);
  assert.equal(event.longitude, 128.2);
  assert.equal(event.depthKm, 12);
  assert.equal(event.magnitude, 3.5);
  assert.equal(event.intensityText, "II-III Kab. Halmahera Timur");
  assert.equal(event.tsunami, false);
  assert.equal(event.sourceEventId, buildBmkgSourceEventId("2026-06-30T04:46:45.000Z", 1.15, 128.2));
});

test("interpreta potencial positivo de tsunami BMKG", () => {
  const event = normalizeBmkgRecord(
    {
      DateTime: "2026-06-30T05:00:00+00:00",
      Coordinates: "-8.20,118.50",
      Magnitude: "7.1",
      Kedalaman: "15 km",
      Potensi: "Berpotensi tsunami"
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.tsunami, true);
});

test("fusiona feeds BMKG sin perder potencial ni intensidad", () => {
  const identity = {
    DateTime: "2026-06-30T05:00:00+00:00",
    Coordinates: "-8.20,118.50",
    Magnitude: "5.6",
    Kedalaman: "10 km",
    Wilayah: "Indonesia"
  };
  const merged = mergeBmkgRecords([
    { ...identity, Potensi: "Tidak berpotensi tsunami" },
    { ...identity, Dirasakan: "III Lombok" }
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].Potensi, "Tidak berpotensi tsunami");
  assert.equal(merged[0].Dirasakan, "III Lombok");
});

test("extrae identificador CWA desde la URL oficial", () => {
  const sourceEventId = buildCwaSourceEventId({
    Web: "https://scweb.cwa.gov.tw/en-US/earthquake/details/2026063005150250",
    EarthquakeInfo: {
      OriginTime: "2026-06-30T05:15:02+08:00",
      Epicenter: { EpicenterLatitude: 24.8, EpicenterLongitude: 122.11 },
      EarthquakeMagnitude: { MagnitudeValue: 5.0 }
    }
  });

  assert.equal(sourceEventId, "2026063005150250");
});

test("genera fallback estable para CWA cuando falta Web", () => {
  const record = {
    IssueTime: "2026-06-30T05:19:23+08:00",
    EarthquakeInfo: {
      OriginTime: "2026-06-30T05:15:02+08:00",
      Epicenter: { EpicenterLatitude: 24.8, EpicenterLongitude: 122.11 },
      EarthquakeMagnitude: { MagnitudeValue: 5.0 }
    }
  };

  const first = buildCwaSourceEventId(record);
  const second = buildCwaSourceEventId(record);
  assert.ok(first);
  assert.equal(first, second);
});

test("normaliza reporte oficial CWA con intensidad maxima y estaciones", () => {
  const event = normalizeCwaRecord(
    {
      IssueTime: "2026-06-30T05:19:23+08:00",
      EarthquakeNo: 115000,
      Web: "https://scweb.cwa.gov.tw/en-US/earthquake/details/2026063005150250",
      EarthquakeInfo: {
        OriginTime: "2026-06-30T05:15:02+08:00",
        FocalDepth: 94.1,
        Epicenter: {
          Location: "36.4 km ENE of Yilan County Hall",
          EpicenterLatitude: 24.8,
          EpicenterLongitude: 122.11
        },
        EarthquakeMagnitude: {
          MagnitudeType: "ML",
          MagnitudeValue: 5.0
        }
      },
      Intensity: {
        ShakingArea: [
          {
            AreaIntensity: "2",
            EqStation: [
              { StationID: "ENA", StationName: "Nan-ao" },
              { StationID: "ENT", StationName: "Niudou" }
            ]
          },
          {
            AreaIntensity: "1",
            EqStation: [{ StationID: "HWA", StationName: "Hualien City" }]
          }
        ]
      }
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.source, "CWA");
  assert.equal(event.sourceEventId, "2026063005150250");
  assert.equal(event.eventTimeUtc, "2026-06-29T21:15:02.000Z");
  assert.equal(event.updatedAtUtc, "2026-06-29T21:19:23.000Z");
  assert.equal(event.depthKm, 94.1);
  assert.equal(event.magnitudeType, "ML");
  assert.equal(event.intensityText, "CWA 2");
  assert.equal(event.stationCount, 3);
  assert.equal(event.sourceUrl, "https://scweb.cwa.gov.tw/en-US/earthquake/details/2026063005150250");
});

test("descarta registros CWA con coordenadas o magnitud invalidas", () => {
  assert.equal(
    normalizeCwaRecord(
      {
        IssueTime: "2026-06-30T05:19:23+08:00",
        EarthquakeInfo: {
          OriginTime: "2026-06-30T05:15:02+08:00",
          Epicenter: { EpicenterLatitude: 95, EpicenterLongitude: 122.11 },
          EarthquakeMagnitude: { MagnitudeValue: 5.0 }
        }
      },
      INGESTED_AT
    ),
    null
  );
  assert.equal(
    normalizeCwaRecord(
      {
        IssueTime: "2026-06-30T05:19:23+08:00",
        Web: "https://scweb.cwa.gov.tw/en-US/earthquake/details/2026063005150250",
        EarthquakeInfo: {
          OriginTime: "2026-06-30T05:15:02+08:00",
          Epicenter: { EpicenterLatitude: 24.8, EpicenterLongitude: 122.11 },
          EarthquakeMagnitude: { MagnitudeValue: Number.NaN }
        }
      },
      INGESTED_AT
    ),
    null
  );
});

test("normaliza fecha, coordenadas e intensidad oficial JMA", () => {
  const event = normalizeJmaRecord(
    {
      eid: "20260630230228",
      ctt: "20260630230621",
      at: "2026-06-30T23:02:00+09:00",
      rdt: "2026-06-30T23:06:00+09:00",
      cod: "+40.1+142.4-40000/",
      mag: "4.9",
      maxi: "3",
      en_anm: "Off the Coast of Iwate Prefecture",
      json: "20260630230621_20260630230228_VXSE5k_1.json"
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.source, "JMA");
  assert.equal(event.sourceEventId, "20260630230228");
  assert.equal(event.eventTimeUtc, "2026-06-30T14:02:00.000Z");
  assert.equal(event.latitude, 40.1);
  assert.equal(event.longitude, 142.4);
  assert.equal(event.depthKm, 40);
  assert.equal(event.intensityText, "JMA 3");
});

test("consolida reportes JMA por eid y conserva intensidad", () => {
  const consolidated = consolidateJmaRecords([
    {
      eid: "event-1",
      ctt: "20260630230401",
      at: "2026-06-30T23:02:00+09:00",
      maxi: "3"
    },
    {
      eid: "event-1",
      ctt: "20260630230513",
      at: "2026-06-30T23:02:00+09:00",
      cod: "+40.1+142.4-40000/",
      mag: "4.9"
    }
  ]);

  assert.equal(consolidated.length, 1);
  assert.equal(consolidated[0].reports.length, 2);
  assert.equal(consolidated[0].record.mag, "4.9");
  assert.equal(consolidated[0].record.maxi, "3");
});

test("descarta registros JMA con fecha o coordenadas invalidas", () => {
  assert.equal(
    normalizeJmaRecord(
      {
        eid: "event-invalid-date",
        at: "fecha-invalida",
        cod: "+35.0+140.0-10000/",
        mag: "4.0"
      },
      INGESTED_AT
    ),
    null
  );
  assert.equal(
    normalizeJmaRecord(
      {
        eid: "event-invalid-coordinates",
        at: "2026-06-30T23:02:00+09:00",
        cod: "+95.0+140.0-10000/",
        mag: "4.0"
      },
      INGESTED_AT
    ),
    null
  );
});

test("combina fecha y hora UTC de IGP/CENSIS", () => {
  const event = normalizeIgpRecord(
    {
      codigo: "2026-0392",
      fecha_utc: "2026-06-30T00:00:00.000Z",
      hora_utc: "1970-01-01T02:24:17.000Z",
      latitud: "-10.20",
      longitud: "-78.30",
      magnitud: "3.9",
      profundidad: 35,
      referencia: "Huarmey - Ancash",
      intensidad: "III Huarmey",
      publicado: "1"
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.eventTimeUtc, "2026-06-30T02:24:17.000Z");
  assert.equal(event.intensityText, "III Huarmey");
  assert.equal(event.status, "official");
});

test("convierte hora local UTC-4 y genera id estable para FUNVISIS", () => {
  const feature = {
    geometry: { coordinates: [-66.79, 10.63] as [number, number] },
    properties: {
      phoneFormatted: "10.2 km",
      phone: "2.1",
      address: "6 km al oeste de Naiguata",
      city: "20:07",
      postalCode: "29-06-2026"
    }
  };
  const first = normalizeFunvisisFeature(feature, INGESTED_AT);
  const second = normalizeFunvisisFeature(feature, INGESTED_AT);

  assert.ok(first && second);
  assert.equal(first.eventTimeUtc, "2026-06-30T00:07:00.000Z");
  assert.equal(first.sourceEventId, second.sourceEventId);
  assert.equal(first.depthKm, 10.2);
});

test("normaliza contexto GDACS sin convertirlo en evento sismico", () => {
  const context = normalizeGdacsFeature({
    geometry: { coordinates: [-66.5, 10.5] },
    properties: {
      eventid: 1548000,
      name: "Earthquake in Venezuela",
      alertlevel: "Red",
      alertscore: 2.5,
      country: "Venezuela",
      fromdate: "2026-06-26T10:00:00",
      datemodified: "2026-06-26T10:05:00",
      url: { report: "https://www.gdacs.org/report.aspx" }
    }
  });

  assert.ok(context);
  assert.equal(context.source, "GDACS");
  assert.equal(context.alertLevel, "Red");
  assert.equal(context.eventId, null);
});

test("parsea producto CAP-TSU de NOAA", () => {
  const xml = `<?xml version="1.0"?>
    <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
      <identifier>PHEB-test</identifier>
      <sender>ntwc@noaa.gov</sender>
      <sent>2026-06-30T05:00:00Z</sent>
      <status>Actual</status>
      <msgType>Alert</msgType>
      <source>PTWC</source>
      <info>
        <event>Tsunami Information</event>
        <urgency>Unknown</urgency>
        <severity>Minor</severity>
        <certainty>Unlikely</certainty>
        <expires>2026-06-30T06:00:00Z</expires>
        <description>Informacion oficial de prueba</description>
        <web>https://www.tsunami.gov/</web>
        <area><areaDesc>Pacific Ocean</areaDesc></area>
      </info>
    </alert>`;
  const product = parseNoaaCap(xml, "NOAA_PTWC", "https://www.tsunami.gov/");

  assert.equal(product.identifier, "PHEB-test");
  assert.equal(product.center, "PTWC");
  assert.equal(product.areaDescription, "Pacific Ocean");
});

test("aplica prioridad regional a Peru y Venezuela", () => {
  assert.ok(sourcePriority("IGP", -12, -77) > sourcePriority("USGS", -12, -77));
  assert.ok(sourcePriority("FUNVISIS", 10.5, -67) > sourcePriority("USGS", 10.5, -67));
  assert.ok(sourcePriority("USGS", 35, 140) > sourcePriority("EMSC", 35, 140));
  assert.ok(sourcePriority("GEONET", -41.2, 174.8) > sourcePriority("USGS", -41.2, 174.8));
  assert.ok(sourcePriority("BMKG", -6.2, 106.8) > sourcePriority("USGS", -6.2, 106.8));
  assert.ok(sourcePriority("JMA", 35.7, 139.7) > sourcePriority("USGS", 35.7, 139.7));
  assert.ok(sourcePriority("CWA", 24.8, 121.0) > sourcePriority("USGS", 24.8, 121.0));
  assert.ok(sourcePriority("CWA", 24.8, 122.11) > sourcePriority("JMA", 24.8, 122.11));
  assert.ok(sourcePriority("USGS", -12, -77) > sourcePriority("GEOFON", -12, -77));
  assert.ok(sourcePriority("USGS", -12, -77) > sourcePriority("BMKG", -12, -77));
  assert.ok(sourcePriority("USGS", -12, -77) > sourcePriority("JMA", -12, -77));
  assert.ok(sourcePriority("USGS", -12, -77) > sourcePriority("CWA", -12, -77));
});

test("respeta limites estrictos de deduplicacion", () => {
  assert.equal(isAssociationCandidate(60, 99.9, 0.49), true);
  assert.equal(isAssociationCandidate(60.1, 50, 0.1), false);
  assert.equal(isAssociationCandidate(20, 100, 0.1), false);
  assert.equal(isAssociationCandidate(20, 50, 0.5), false);
  assert.equal(isAssociationCandidate(20, 50, null), true);
});
