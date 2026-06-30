import { normalizeUsgsFeature, type UsgsGeoJson } from "@sismica/shared";

import { env } from "../config/env.js";
import { fetchJson } from "./http.js";
import { assertShape, usgsGeoJsonSchema } from "./schemas.js";
import { type SeismicProvider } from "./types.js";

export const usgsProvider: SeismicProvider = {
  code: "USGS",
  async fetchEvents() {
    const payload = await fetchJson<UsgsGeoJson>(env.usgsFeedUrl);
    assertShape(usgsGeoJsonSchema, payload, "USGS");
    const ingestedAt = new Date().toISOString();
    return payload.features.map((feature) => ({
      event: normalizeUsgsFeature(feature, ingestedAt),
      rawPayload: feature
    }));
  }
};
