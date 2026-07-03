import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSeaLevelSnapshot,
  detectSeaLevelRecentMoves,
  normalizeSeaLevelSeries,
  normalizeSeaLevelStations
} from "../src/lib/seaLevel";

test("normalizeSeaLevelStations prioriza sensores oceanograficos y normaliza campos base", () => {
  const stations = normalizeSeaLevelStations(
    [
      {
        Code: "acaj",
        Location: "ACAJUTLA_SV",
        country: "svd",
        countryname: "EL SALVADOR",
        Lat: 13.573792,
        Lon: -89.838128,
        sensor: "bat",
        rate: 1,
        units: "M",
        lasttime: "2026-07-03 01:20:00.000",
        lastupdate: "2026-07-03 01:22:00.000",
        lastvalue: 9.99,
        connect: "SZXX01"
      },
      {
        Code: "acaj",
        Location: "ACAJUTLA_SV",
        country: "svd",
        countryname: "EL SALVADOR",
        Lat: 13.573792,
        Lon: -89.838128,
        sensor: "rad",
        rate: 1,
        units: "M",
        lasttime: "2026-07-03 01:54:00.000",
        lastupdate: "2026-07-03 02:01:09.940",
        lastvalue: 1.546,
        connect: "SZXX01",
        GlossID: "182"
      }
    ],
    Date.parse("2026-07-03T02:05:00.000Z")
  );

  assert.equal(stations.length, 1);
  assert.equal(stations[0].stationCode, "acaj");
  assert.equal(stations[0].name, "Acajutla Sv");
  assert.equal(stations[0].countryCode, "SVD");
  assert.equal(stations[0].countryName, "El Salvador");
  assert.equal(stations[0].sensor, "rad");
  assert.equal(stations[0].lastValue, 1.546);
  assert.equal(stations[0].status, "online");
  assert.equal(stations[0].lastObservationAtUtc, "2026-07-03T01:54:00.000Z");
  assert.equal(stations[0].availableSensors.join(","), "bat,rad");
});

test("normalizeSeaLevelStations clasifica estaciones atrasadas y offline", () => {
  const stations = normalizeSeaLevelStations(
    [
      {
        Code: "slow",
        Location: "Slow Harbor",
        countryname: "Chile",
        Lat: -33.1,
        Lon: -71.6,
        sensor: "rad",
        rate: 5,
        lasttime: "2026-07-03 00:00:00.000",
        lastupdate: "2026-07-03 00:05:00.000",
        lastvalue: 1.2
      },
      {
        Code: "dead",
        Location: "Dead Harbor",
        countryname: "Peru",
        Lat: -12.0,
        Lon: -77.1,
        sensor: "rad",
        rate: 5,
        lasttime: "2026-07-01 00:00:00.000",
        lastupdate: "2026-07-01 00:05:00.000",
        lastvalue: 0.8
      },
      {
        Code: "bad",
        Location: "Invalid Station",
        countryname: "Peru",
        Lat: null,
        Lon: -77.1,
        sensor: "rad"
      }
    ],
    Date.parse("2026-07-03T02:05:00.000Z")
  );

  assert.equal(stations.length, 2);
  assert.equal(stations.find((station) => station.stationCode === "slow")?.status, "delayed");
  assert.equal(stations.find((station) => station.stationCode === "dead")?.status, "offline");
});

test("normalizeSeaLevelSeries filtra sensores no deseados y resume tendencia reciente", () => {
  const series = normalizeSeaLevelSeries(
    [
      { slevel: 1.1, stime: "2026-07-03 00:00:00", sensor: "rad" },
      { slevel: 1.12, stime: "2026-07-03 01:00:00", sensor: "rad" },
      { slevel: 1.15, stime: "2026-07-03 02:00:00", sensor: "rad" },
      { slevel: 1.18, stime: "2026-07-03 03:00:00", sensor: "rad" },
      { slevel: -999, stime: "2026-07-03 03:05:00", sensor: "rad" },
      { slevel: 5.7, stime: "2026-07-03 03:00:00", sensor: "atm" }
    ],
    {
      stationCode: "acaj",
      sensor: "rad",
      unit: "M",
      windowHours: 6
    }
  );

  assert.equal(series.points.length, 4);
  assert.equal(series.latestValue, 1.18);
  assert.equal(series.latestObservationAtUtc, "2026-07-03T03:00:00.000Z");
  assert.equal(series.rangeValue, 0.08);
  assert.equal(series.changeValue, 0.08);
  assert.equal(series.trend, "rising");
});

test("detectSeaLevelRecentMoves compara dos lecturas consecutivas y ordena por amplitud", () => {
  const previousStations = normalizeSeaLevelStations(
    [
      {
        Code: "rise",
        Location: "Rise Port",
        countryname: "Chile",
        Lat: -20,
        Lon: -70,
        sensor: "rad",
        units: "M",
        lasttime: "2026-07-03 01:00:00.000",
        lastvalue: 1.1
      },
      {
        Code: "fall",
        Location: "Fall Port",
        countryname: "Peru",
        Lat: -12,
        Lon: -77,
        sensor: "rad",
        units: "M",
        lasttime: "2026-07-03 01:00:00.000",
        lastvalue: 2.0
      }
    ],
    Date.parse("2026-07-03T01:10:00.000Z")
  );

  const nextStations = normalizeSeaLevelStations(
    [
      {
        Code: "rise",
        Location: "Rise Port",
        countryname: "Chile",
        Lat: -20,
        Lon: -70,
        sensor: "rad",
        units: "M",
        lasttime: "2026-07-03 01:05:00.000",
        lastvalue: 1.17
      },
      {
        Code: "fall",
        Location: "Fall Port",
        countryname: "Peru",
        Lat: -12,
        Lon: -77,
        sensor: "rad",
        units: "M",
        lasttime: "2026-07-03 01:05:00.000",
        lastvalue: 1.91
      }
    ],
    Date.parse("2026-07-03T01:10:00.000Z")
  );

  const moves = detectSeaLevelRecentMoves(nextStations, buildSeaLevelSnapshot(previousStations));

  assert.equal(moves.length, 2);
  assert.equal(moves[0].stationCode, "fall");
  assert.equal(moves[0].trend, "falling");
  assert.equal(moves[0].deltaValue, -0.09);
  assert.equal(moves[1].stationCode, "rise");
  assert.equal(moves[1].trend, "rising");
  assert.equal(moves[1].deltaValue, 0.07);
});
