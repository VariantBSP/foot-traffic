import type { DataResult, PedestrianAccessibility } from "../types/signals.js";

const ORS_BASE = "https://api.openrouteservice.org/v2";

interface OrsIsochroneResponse {
  type:     string;
  features: Array<{
    type:       string;
    properties: { value: number; area: number };
    geometry:   { type: string; coordinates: unknown[][] };
  }>;
}

// Walking time ranges: 5 min, 10 min, 15 min
const RANGES_SECONDS = [300, 600, 900];

export async function fetchPedestrianAccessibility(
  lat:    number,
  lon:    number,
  apiKey: string | null,
): Promise<DataResult<PedestrianAccessibility>> {
  const source = "openrouteservice" as const;
  const now    = new Date().toISOString();

  if (!apiKey) {
    return {
      data: null,
      availability: { source, status: "unavailable", last_updated: now, expires_at: null, note: "OPENROUTESERVICE_API_KEY not set — register free at openrouteservice.org" },
    };
  }

  try {
    const res = await fetch(`${ORS_BASE}/isochrones/foot-walking`, {
      method:  "POST",
      signal:  AbortSignal.timeout(10_000),
      headers: {
        "Authorization": apiKey,
        "Content-Type":  "application/json",
        "Accept":        "application/json, application/geo+json",
      },
      body: JSON.stringify({
        locations:   [[lon, lat]],  // ORS uses [lon, lat] order
        range:       RANGES_SECONDS,
        range_type:  "time",
        attributes:  ["area"],
      }),
    });

    if (!res.ok) throw new Error(`ORS HTTP ${res.status}`);
    const json = await res.json() as OrsIsochroneResponse;

    return {
      data: {
        profile:         "foot-walking",
        ranges_seconds:  RANGES_SECONDS,
        isochrone_count: json.features.length,
        features:        json.features.map(f => ({
          range_seconds:       f.properties.value,
          area_square_meters:  Math.round(f.properties.area),
        })),
      },
      availability: {
        source,
        status:       "available",
        last_updated: now,
        expires_at:   new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        note:         null,
      },
    };
  } catch (err) {
    return {
      data: null,
      availability: {
        source,
        status:       "unavailable",
        last_updated: now,
        expires_at:   null,
        note:         err instanceof Error ? err.message : String(err),
      },
    };
  }
}
