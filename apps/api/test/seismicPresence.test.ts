import assert from "node:assert/strict";
import test from "node:test";

import { resolveSeismicCountry } from "../src/services/seismicPresenceRepository.js";

test("clasifica fuentes nacionales y titulos globales de forma determinista", () => {
  assert.equal(resolveSeismicCountry("IGP", "Costa de Arequipa"), "pe");
  assert.equal(resolveSeismicCountry("USGS", "10 km SW of Anchorage, Alaska"), "us");
  assert.equal(resolveSeismicCountry("EMSC", "NORTHERN ITALY"), "it");
  assert.equal(resolveSeismicCountry("USGS", "Mid-Atlantic Ridge"), null);
});
