import assert from "node:assert/strict";
import test from "node:test";

import { buildMapAreaPrecacheUrls, buildMapOverviewPrecacheUrls } from "../src/lib/mapCache";

test("buildMapOverviewPrecacheUrls covers low zooms with the label-free base", () => {
  const urls = buildMapOverviewPrecacheUrls(2);

  assert.equal(urls.length, 21);
  assert.equal(
    urls.some((url) => url.endsWith("/dark_nolabels/0/0/0.png")),
    true
  );
  assert.equal(
    urls.some((url) => url.includes("dark_only_labels")),
    false
  );
});

test("buildMapAreaPrecacheUrls builds a bounded three-level ring around an event", () => {
  const urls = buildMapAreaPrecacheUrls(-12, -77);

  assert.equal(urls.length, 27);
  assert.equal(urls.includes("https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/4/4/8.png"), true);
  assert.equal(
    urls.some((url) => url.includes("dark_only_labels")),
    false
  );
  assert.equal(
    urls.every((url) => !url.includes("{s}")),
    true
  );
  assert.equal(
    urls.every((url) => /https:\/\/[a-d]\.basemaps\.cartocdn\.com\//.test(url)),
    true
  );
});

test("buildMapAreaPrecacheUrls wraps the antimeridian and rejects invalid coordinates", () => {
  const datelineUrls = buildMapAreaPrecacheUrls(0, 180, [2], 1);

  assert.equal(datelineUrls.length, 9);
  assert.equal(
    datelineUrls.some((url) => /\/2\/0\/\d/.test(url)),
    true
  );
  assert.equal(
    datelineUrls.some((url) => /\/2\/3\/\d/.test(url)),
    true
  );
  assert.deepEqual(buildMapAreaPrecacheUrls(Number.NaN, 0), []);
  assert.deepEqual(buildMapAreaPrecacheUrls(0, Number.POSITIVE_INFINITY), []);
});
