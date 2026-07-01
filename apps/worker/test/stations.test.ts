import assert from "node:assert/strict";
import test from "node:test";

import { parseFdsnStationText } from "../src/providers/geofonStationProvider.js";

const fixture = `#Network|Station|Latitude|Longitude|Elevation|SiteName|StartTime|EndTime
GE|SANT|-12.5000|-77.2500|120.0|Estacion Lima|2000-01-01T00:00:00|
GE|BAD|999|-77|0|Invalida||`;

test("parseFdsnStationText maps named columns and rejects invalid coordinates", () => {
  const result = parseFdsnStationText(fixture);
  assert.equal(result.length, 1);
  assert.deepEqual(
    {
      stationId: result[0].stationId,
      latitude: result[0].latitude,
      longitude: result[0].longitude,
      siteName: result[0].siteName
    },
    {
      stationId: "GEOFON:GE.SANT",
      latitude: -12.5,
      longitude: -77.25,
      siteName: "Estacion Lima"
    }
  );
});

test("parseFdsnStationText resolves reordered columns by header", () => {
  const result = parseFdsnStationText("#Station|Longitude|Network|Latitude|SiteName\nABC|10.5|GE|-4.2|Alpha");
  assert.equal(result[0].stationId, "GEOFON:GE.ABC");
  assert.equal(result[0].elevationM, null);
});

test("parseFdsnStationText rejects a response without a named header", () => {
  assert.throws(() => parseFdsnStationText("GE|ABC|1|2"), /no named header/);
});
