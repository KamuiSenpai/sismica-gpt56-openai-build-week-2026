import assert from "node:assert/strict";
import test from "node:test";

import { normalizeUsgsFeature } from "@sismica/shared";

import {
  buildBmkgSourceEventId,
  mergeBmkgRecords,
  normalizeBmkgRecord
} from "../src/providers/bmkgProvider.js";
import {
  extractCsnHomeEntries,
  normalizeCsnDetail,
  parseCsnDetailPage
} from "../src/providers/csnProvider.js";
import { buildCwaSourceEventId, normalizeCwaRecord } from "../src/providers/cwaProvider.js";
import { normalizeEmscFeature, parseEmscResponse } from "../src/providers/emscProvider.js";
import { normalizeFunvisisFeature } from "../src/providers/funvisisProvider.js";
import { normalizeGdacsFeature } from "../src/providers/gdacsProvider.js";
import { normalizeGeoNetFeature } from "../src/providers/geoNetProvider.js";
import { normalizeGeofonRecord, parseFdsnText } from "../src/providers/geofonProvider.js";
import { normalizeFdsnRecord } from "../src/providers/fdsnProvider.js";
import { extractNamedJsonObject, normalizeIgnFeature } from "../src/providers/ignProvider.js";
import { normalizeIgpRecord } from "../src/providers/igpProvider.js";
import {
  buildIngvQueryWindows,
  formatIngvUtcDateTime,
  normalizeIngvRecord
} from "../src/providers/ingvProvider.js";
import { normalizeIgepnRecord, parseIgepnCsv } from "../src/providers/igepnProvider.js";
import { normalizeInpresItem, parseInpresXml } from "../src/providers/inpresProvider.js";
import { normalizeInsivumehRecord, parseInsivumehMarkers } from "../src/providers/insivumehProvider.js";
import { consolidateJmaRecords, normalizeJmaRecord } from "../src/providers/jmaProvider.js";
import { normalizeMarnRecord, parseMarnHtml } from "../src/providers/marnProvider.js";
import { parseNoaaCap } from "../src/providers/noaaProvider.js";
import { normalizeOvsicoriRecord, parseOvsicoriMarkers } from "../src/providers/ovsicoriProvider.js";
import { normalizeSgcFeature } from "../src/providers/sgcProvider.js";
import { normalizeSsnItem } from "../src/providers/ssnProvider.js";
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

test("repara el separador duplicado del historico EMSC", () => {
  const payload = '{"features":[,{"id":"a"},,{"id":"b"},]}';
  const parsed = parseEmscResponse(payload);

  assert.deepEqual(
    parsed.features?.map((feature) => feature.id),
    ["a", "b"]
  );
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

test("tolera variante FDSN de SCEDC con fecha slash y cabecera Longtitude", () => {
  const payload = [
    "#EventID  | Time                | Latitude | Longtitude   | Depth/km | Author | Catalog | ET | GT   | MagType | Magnitude | MagAuthor | EventLocationName",
    "10245278 | 2026/06/29 11:35:33.6290 | 43.38280 | -127.0788000 | 10.00    | US     | SCEDC   | eq | t |   w     |  5.50     | US        |  221.9 km WNW from Port Orford, OR",
    "",
    "# of events : 1"
  ].join("\n");

  const records = parseFdsnText(payload);
  const event = normalizeFdsnRecord(
    records[0],
    "SCEDC",
    "SCEDC",
    "https://service.scedc.caltech.edu/fdsnws/event/1/query",
    INGESTED_AT
  );

  assert.equal(records.length, 1);
  assert.ok(event);
  assert.equal(event.source, "SCEDC");
  assert.equal(event.eventTimeUtc, "2026-06-29T11:35:33.629Z");
  assert.equal(event.longitude, -127.0788);
  assert.equal(event.eventType, "earthquake");
  assert.equal(event.networkCode, "US");
});

test("normaliza FDSN estandar de KNMI", () => {
  const event = normalizeFdsnRecord(
    {
      EventID: "knmi2026mlbv",
      Time: "2026-06-24T21:59:57.1",
      Latitude: "53.312",
      Longitude: "6.888",
      "Depth/km": "3.0",
      Contributor: "KNMI",
      ContributorID: "knmi2026mlbv",
      MagType: "MLn",
      Magnitude: "1.3798966264661987",
      EventLocationName: "Meedhuizen",
      EventType: "induced or triggered event"
    },
    "KNMI",
    "KNMI",
    "https://rdsa.knmi.nl/fdsnws/event/1/query",
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.source, "KNMI");
  assert.equal(event.eventTimeUtc, "2026-06-24T21:59:57.100Z");
  assert.equal(event.eventType, "induced or triggered event");
  assert.equal(event.sourceUrl, "https://rdsa.knmi.nl/fdsnws/event/1/query?eventid=knmi2026mlbv");
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

test("extrae coleccion oficial IGN desde javascript publicado", () => {
  const collection = extractNamedJsonObject(
    [
      'var dias3 = {"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[-9.0702,38.3665]},"properties":{"evid":"es2026mrygt","mag":"1.9","magtype":"mbLg","intensidad":" ","depth":"0","fecha":"2026-06-30 13:04:09","loc":"SE SESIMBRA.POR"}}]};',
      'var dias10 = {"type":"FeatureCollection","features":[]};'
    ].join("\n"),
    "dias3"
  ) as { features: Array<{ properties: { evid: string } }> };

  assert.equal(collection.features.length, 1);
  assert.equal(collection.features[0].properties.evid, "es2026mrygt");
});

test("normaliza evento oficial IGN", () => {
  const event = normalizeIgnFeature(
    {
      geometry: { coordinates: [-9.0702, 38.3665] },
      properties: {
        evid: "es2026mrygt",
        mag: "1.9",
        magtype: "mbLg",
        intensidad: " ",
        depth: "0",
        fecha: "2026-06-30 13:04:09",
        loc: "SE SESIMBRA.POR"
      }
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.source, "IGN");
  assert.equal(event.eventTimeUtc, "2026-06-30T13:04:09.000Z");
  assert.equal(event.magnitude, 1.9);
  assert.equal(
    event.sourceUrl,
    "https://www.ign.es/web/ign/portal/ultimos-terremotos/-/ultimos-terremotos/getDetails?evid=es2026mrygt"
  );
});

test("normaliza evento oficial SGC con coordenadas del feed regional", () => {
  const event = normalizeSgcFeature(
    {
      id: "SGC2026mtpzgy",
      geometry: {
        coordinates: [11.072833333333334, -73.44583333333334, 20]
      },
      properties: {
        agency: "SGC",
        cdi: 0,
        felt: 0,
        gap: 132,
        mag: 3.2,
        magType: "MLr_4",
        mmi: 0,
        nst: 28,
        place: "Dibulla - la Guajira, Colombia",
        rms: 0.5,
        status: "manual",
        type: "earthquake",
        updated: "2026-06-30 10:50:55",
        utcTime: "2026-06-30 15:43"
      }
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.source, "SGC");
  assert.equal(event.latitude, 11.072833333333334);
  assert.equal(event.longitude, -73.44583333333334);
  assert.equal(event.depthKm, 20);
  assert.equal(event.status, "official");
  assert.equal(event.updatedAtUtc, "2026-06-30T15:50:55.000Z");
  assert.equal(event.sourceUrl, "https://www.sgc.gov.co/detallesismo/SGC2026mtpzgy");
});

test("normaliza evento oficial SSN desde RSS", () => {
  const event = normalizeSsnItem(
    {
      title: "3.3, 16 km al SUR de PETATLAN, GRO",
      description:
        " <p>Fecha:2026-06-30 04:50:59 (Hora de M&eacute;xico)<br/>Lat/Lon: 17.393/-101.287<br/>Profundidad: 18.9 km </p> ",
      link: " http://www2.ssn.unam.mx:8080/jsp/localizacion-de-sismo.jsp?latitud=17.393&longitud=-101.287&prf=18.9 km&ma=3.3&fecha=2026-06-30&hora=04:50:59&loc=16 km al SUR de PETATLAN, GRO&evento=1 ",
      lat: 17.393,
      long: -101.287
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.source, "SSN");
  assert.equal(event.eventTimeUtc, "2026-06-30T10:50:59.000Z");
  assert.equal(event.magnitude, 3.3);
  assert.equal(event.depthKm, 18.9);
  assert.equal(event.latitude, 17.393);
  assert.equal(event.longitude, -101.287);
  assert.equal(event.status, "official");
  assert.ok(event.sourceUrl?.includes("localizacion-de-sismo.jsp"));
});

test("extrae informes recientes oficiales desde portada CSN", () => {
  const entries = extractCsnHomeEntries(
    [
      "<tr>",
      '  <td><a href="/sismicidad/informes/2026/06/372151.html">2026-06-30 14:19:22</a><br>',
      "      31 km al SO de Pica",
      "  </td>",
      "  <td>48 km</td>",
      '  <td class="magnitud">3.8</td>',
      "</tr>",
      "<tr>",
      '  <td><a href="/sismicidad/informes/2026/06/372144.html">2026-06-30 13:38:14</a><br>',
      "      112 km al O de Caldera",
      "  </td>",
      "  <td>25 km</td>",
      '  <td class="magnitud">2.6</td>',
      "</tr>"
    ].join("\n")
  );

  assert.equal(entries.length, 2);
  assert.equal(entries[0].sourceEventId, "372151");
  assert.equal(entries[1].path, "/sismicidad/informes/2026/06/372144.html");
});

test("parsea y normaliza detalle oficial CSN", () => {
  const detail = parseCsnDetailPage(
    [
      "<table>",
      "  <tbody>",
      "    <tr><td>Referencia</td><td>112 km al O de Caldera</td></tr>",
      "    <tr><td>Hora Local</td><td>13:38:14 30/06/2026</td></tr>",
      "    <tr><td>Hora UTC</td><td>17:38:14 30/06/2026</td></tr>",
      "    <tr><td>Latitud</td><td>-27.21</td></tr>",
      "    <tr><td>Longitud</td><td>-71.95</td></tr>",
      "    <tr><td>Profundidad</td><td>25 km</td></tr>",
      "    <tr><td>Magnitud</td><td>2.6 MLv</td></tr>",
      "  </tbody>",
      "</table>"
    ].join("\n"),
    "https://www.sismologia.cl/sismicidad/informes/2026/06/372144.html"
  );

  assert.ok(detail);
  assert.equal(detail.sourceEventId, "372144");
  assert.equal(detail.eventTimeUtc, "2026-06-30T17:38:14.000Z");
  assert.equal(detail.latitude, -27.21);
  assert.equal(detail.longitude, -71.95);
  assert.equal(detail.depthKm, 25);
  assert.equal(detail.magnitude, 2.6);
  assert.equal(detail.magnitudeType, "MLv");

  const event = normalizeCsnDetail(detail, INGESTED_AT);
  assert.equal(event.source, "CSN");
  assert.equal(event.title, "M2.6 - 112 km al O de Caldera");
  assert.equal(event.sourceUrl, "https://www.sismologia.cl/sismicidad/informes/2026/06/372144.html");
});

test("formatea fechas INGV en UTC sin sufijo Z y genera ventanas diarias", () => {
  assert.equal(formatIngvUtcDateTime(new Date("2026-06-30T18:45:12.345Z")), "2026-06-30T18:45:12");

  const windows = buildIngvQueryWindows(new Date("2026-06-30T18:45:12.345Z"), 72);
  assert.deepEqual(windows, [
    { starttime: "2026-06-27T00:00:00", endtime: "2026-06-27T23:59:59" },
    { starttime: "2026-06-28T00:00:00", endtime: "2026-06-28T23:59:59" },
    { starttime: "2026-06-29T00:00:00", endtime: "2026-06-29T23:59:59" },
    { starttime: "2026-06-30T00:00:00", endtime: "2026-06-30T23:59:59" }
  ]);
});

test("normaliza evento oficial INGV y descarta eventos fuera de la region operativa", () => {
  const event = normalizeIngvRecord(
    {
      EventID: "46371332",
      Time: "2026-06-29T05:35:29.400000",
      Latitude: "40.7303",
      Longitude: "15.1643",
      "Depth/Km": "10.1",
      Author: "SURVEY-INGV",
      Magnitude: "2.5",
      MagType: "ML",
      EventLocationName: "4 km W Senerchia (AV)",
      EventType: "earthquake"
    },
    INGESTED_AT
  );

  assert.ok(event);
  assert.equal(event.source, "INGV");
  assert.equal(event.eventTimeUtc, "2026-06-29T05:35:29.400Z");
  assert.equal(event.title, "M2.5 - 4 km W Senerchia (AV)");
  assert.equal(event.sourceUrl, "https://terremoti.ingv.it/event/46371332?timezone=UTC");

  assert.equal(
    normalizeIngvRecord(
      {
        EventID: "46375212",
        Time: "2026-06-29T11:35:36.082000",
        Latitude: "43.5305",
        Longitude: "-126.997",
        Magnitude: "5.5",
        EventLocationName: "Off coast of Oregon, United States [Sea: United States]"
      },
      INGESTED_AT
    ),
    null
  );
});

test("parsea CSV oficial IGEPN y normaliza hora local de Ecuador", () => {
  const csv = [
    "latitude,longitude,mag,depth,time,status,id,place",
    "-2.1043,-77.6736,4.30,12.9727,2026/06/30 06:02:05,confirmed,igepn2026mrim,a 53.97 km de Macas, Morona Santiago"
  ].join("\n");

  const records = parseIgepnCsv(csv);
  const event = normalizeIgepnRecord(records[0], INGESTED_AT);

  assert.equal(records.length, 1);
  assert.equal(records[0].place, "a 53.97 km de Macas, Morona Santiago");
  assert.ok(event);
  assert.equal(event.source, "IGEPN");
  assert.equal(event.eventTimeUtc, "2026-06-30T11:02:05.000Z");
  assert.equal(event.magnitude, 4.3);
  assert.equal(event.depthKm, 12.9727);
  assert.equal(event.status, "official");
});

test("parsea XML oficial INPRES y normaliza hora local de Argentina", () => {
  const xml = `<?xml version="1.0"?>
    <lista>
      <item>
        <idSismo>330485</idSismo>
        <fecha>30/06</fecha>
        <hora>06:10:20</hora>
        <latitud>-31.5</latitud>
        <longitud>-68.5</longitud>
        <prof>112</prof>
        <mg>3.4</mg>
        <prov>San Juan</prov>
        <link>../mapa/330485</link>
      </item>
    </lista>`;

  const items = parseInpresXml(xml);
  const event = normalizeInpresItem(items[0], INGESTED_AT, new Date("2026-06-30T12:00:00.000Z"));

  assert.equal(items.length, 1);
  assert.equal(items[0].idSismo, 330485);
  assert.ok(event);
  assert.equal(event.source, "INPRES");
  assert.equal(event.eventTimeUtc, "2026-06-30T09:10:20.000Z");
  assert.equal(event.latitude, -31.5);
  assert.equal(event.longitude, -68.5);
  assert.equal(event.sourceUrl, "http://contenidos.inpres.gob.ar/mapa/330485");
});

test("parsea tabla oficial MARN con intensidad reportada", () => {
  const html = `
    <table>
      <tr>
        <td>1</td><td>2026-06-30</td><td>06:35:00</td><td>13.115</td>
        <td>-89.576836</td><td>Frente a la costa de La Libertad</td>
        <td>II en San Salvador</td><td>3.9</td><td>36.85</td>
      </tr>
    </table>`;

  const records = parseMarnHtml(html);
  const event = normalizeMarnRecord(records[0], INGESTED_AT);

  assert.equal(records.length, 1);
  assert.ok(event);
  assert.equal(event.source, "MARN");
  assert.equal(event.eventTimeUtc, "2026-06-30T12:35:00.000Z");
  assert.equal(event.intensityText, "II en San Salvador");
  assert.equal(event.magnitude, 3.9);
  assert.equal(event.depthKm, 36.85);
});

test("parsea marcador OVSICORI y conserva revision oficial", () => {
  const html = `
    L.marker([8.8952,-84.4345]).bindPopup('<table>
      <tr><td>Magnitud:</td><td>2.8</td></tr>
      <tr><td>Fecha y Hora Local:</td><td>2026-06-16 02:37:09</td></tr>
      <tr><td>Ubicacion:</td><td>10 km al Sur de Quepos</td></tr>
      <tr><td>Prof. [km]:</td><td>4</td></tr>
      <tr><td>Revisado:</td><td>y</td></tr>
      <tr><td><a href="detalle.php?eqid=1448130">ver</a></td></tr>
    </table>')`;

  const records = parseOvsicoriMarkers(html);
  const event = normalizeOvsicoriRecord(records[0], INGESTED_AT);

  assert.equal(records.length, 1);
  assert.equal(records[0].sourceEventId, "1448130");
  assert.ok(event);
  assert.equal(event.source, "OVSICORI");
  assert.equal(event.eventTimeUtc, "2026-06-16T08:37:09.000Z");
  assert.equal(event.depthKm, 4);
  assert.equal(event.status, "reviewed");
  assert.equal(event.title, "M2.8 - 10 km al Sur de Quepos");
});

test("parsea HTML Leaflet INSIVUMEH con metadatos tecnicos", () => {
  const html = `
    var circle_marker_test = L.circleMarker([13.262, -90.048], {}).addTo(map);
    circle_marker_test.bindPopup('<div>
      ID: insivumeh2026mppx NST: 14 RMS: 0.28 GAP: 0.28
      <a href="/IMM/HISTORICO/insivumeh2026mppx">historico</a>
    </div>');
    circle_marker_test.bindTooltip('<div>
      Magnitud: 2.6 Tiempo de Origen: 2026-06-29 01:30:38 Profundidad: 37.0 km
    </div>');
  `;

  const records = parseInsivumehMarkers(html);
  const event = normalizeInsivumehRecord(records[0], INGESTED_AT);

  assert.equal(records.length, 1);
  assert.equal(records[0].sourceEventId, "insivumeh2026mppx");
  assert.ok(event);
  assert.equal(event.source, "INSIVUMEH");
  assert.equal(event.eventTimeUtc, "2026-06-29T07:30:38.000Z");
  assert.equal(event.stationCount, 14);
  assert.equal(event.rmsSec, 0.28);
  assert.equal(event.azimuthalGapDeg, 0.28);
  assert.equal(event.depthKm, 37);
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
  assert.ok(sourcePriority("SGC", 4.6, -74.1) > sourcePriority("USGS", 4.6, -74.1));
  assert.ok(sourcePriority("IGN", 40.4, -3.7) > sourcePriority("USGS", 40.4, -3.7));
  assert.ok(sourcePriority("SSN", 17.4, -101.3) > sourcePriority("USGS", 17.4, -101.3));
  assert.ok(sourcePriority("CSN", -29.9, -71.3) > sourcePriority("USGS", -29.9, -71.3));
  assert.ok(sourcePriority("INGV", 40.7, 15.1) > sourcePriority("USGS", 40.7, 15.1));
  assert.ok(sourcePriority("IGEPN", -1.2, -78.5) > sourcePriority("USGS", -1.2, -78.5));
  assert.ok(sourcePriority("INPRES", -31.5, -68.5) > sourcePriority("USGS", -31.5, -68.5));
  assert.ok(sourcePriority("MARN", 13.6, -89.0) > sourcePriority("USGS", 13.6, -89.0));
  assert.ok(sourcePriority("OVSICORI", 9.9, -84.1) > sourcePriority("USGS", 9.9, -84.1));
  assert.ok(sourcePriority("INSIVUMEH", 14.6, -90.5) > sourcePriority("USGS", 14.6, -90.5));
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
