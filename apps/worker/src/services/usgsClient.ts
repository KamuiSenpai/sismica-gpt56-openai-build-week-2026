import { type UsgsGeoJson } from "@sismica/shared";

import { env } from "../config/env.js";

export async function fetchUsgsFeed(): Promise<UsgsGeoJson> {
  const response = await fetch(env.usgsFeedUrl);
  if (!response.ok) {
    throw new Error(`USGS request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as UsgsGeoJson;
}

