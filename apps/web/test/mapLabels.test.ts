import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  estimateMapZoom,
  selectMapLabelCandidates,
  type SpanishMapLabel,
  type SpanishMapLabelCatalog
} from "../src/lib/mapLabels";

test("estimateMapZoom increases as the camera approaches the globe", () => {
  assert.equal(estimateMapZoom(40_075_016.686), 1);
  assert.ok(estimateMapZoom(1_000_000) > estimateMapZoom(10_000_000));
  assert.equal(estimateMapZoom(Number.POSITIVE_INFINITY), 0);
});

test("selectMapLabelCandidates handles a viewport crossing the antimeridian", () => {
  const labels: SpanishMapLabel[] = [
    {
      id: "city:fiyi",
      kind: "city",
      name: "Suva",
      latitude: -18.14,
      longitude: 178.44,
      minZoom: 2,
      maxZoom: 20,
      rank: 1
    },
    {
      id: "city:samoa",
      kind: "city",
      name: "Apia",
      latitude: -13.83,
      longitude: -171.75,
      minZoom: 2,
      maxZoom: 20,
      rank: 2
    },
    {
      id: "city:lima",
      kind: "city",
      name: "Lima",
      latitude: -12.05,
      longitude: -77.04,
      minZoom: 2,
      maxZoom: 20,
      rank: 3
    }
  ];

  const selected = selectMapLabelCandidates(labels, {
    zoom: 4,
    bounds: { west: 170, south: -30, east: -160, north: 5 }
  });

  assert.deepEqual(
    selected.map((label) => label.name),
    ["Suva", "Apia"]
  );
});

test("generated Natural Earth catalog provides representative names in Spanish", async () => {
  const rawCatalog = await readFile(new URL("../public/data/map-labels-es.json", import.meta.url), "utf8");
  const catalog = JSON.parse(rawCatalog) as SpanishMapLabelCatalog;

  assert.equal(catalog.language, "es");
  assert.equal(catalog.source.version, "5.1.2");
  assert.ok(catalog.labels.length > 8_500);
  assert.equal(new Set(catalog.labels.map((label) => label.id)).size, catalog.labels.length);
  assert.equal(
    catalog.labels.every(
      (label) =>
        label.name.length > 0 &&
        Number.isFinite(label.latitude) &&
        Number.isFinite(label.longitude) &&
        label.latitude >= -90 &&
        label.latitude <= 90 &&
        label.longitude >= -180 &&
        label.longitude <= 180
    ),
    true
  );

  const namesByKind = (kind: SpanishMapLabel["kind"]) =>
    new Set(catalog.labels.filter((label) => label.kind === kind).map((label) => label.name));
  const countries = namesByKind("country");
  const cities = namesByKind("city");
  const marine = new Set([...namesByKind("marine")].map((name) => name.toLocaleLowerCase("es")));

  for (const name of ["Estados Unidos", "Japón"]) assert.equal(countries.has(name), true);
  for (const name of ["Pekín", "Moscú", "Ciudad de México"]) assert.equal(cities.has(name), true);
  assert.equal(marine.has("océano pacífico"), true);

  for (const englishName of ["United States of America", "Japan"]) {
    assert.equal(countries.has(englishName), false);
  }
  for (const englishName of ["Beijing", "Moscow"]) assert.equal(cities.has(englishName), false);
  assert.equal(marine.has("pacific ocean"), false);
});
