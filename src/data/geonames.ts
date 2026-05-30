import type { DataResult, PopulationSignal } from "../types/signals.js";

const GEONAMES_BASE = "http://api.geonames.org";

interface GeonamesEntry {
  name:         string;
  countryName:  string;
  population:   number;
  fcl:          string; // feature class: P = populated place
  distance:     string; // km
}

interface GeonamesResponse {
  geonames?: GeonamesEntry[];
  status?:   { message: string; value: number };
}

export async function fetchPopulationSignal(
  lat:      number,
  lon:      number,
  username: string | null,
): Promise<DataResult<PopulationSignal>> {
  const source = "geonames" as const;
  const now    = new Date().toISOString();

  if (!username) {
    return {
      data: null,
      availability: { source, status: "unavailable", last_updated: now, expires_at: null, note: "GEONAMES_USERNAME not set — register free at geonames.org" },
    };
  }

  try {
    // Use findNearbyPlaceNameJSON with a 20km radius and maxRows=10.
    // Then pick the entry with the HIGHEST population from all results.
    // A single wide-radius call avoids breaking early on micro-neighborhoods:
    // Times Square at 1km finds "Midtown West" (45k) and stops — at 20km the
    // same call returns New York City (8M) in the same result set.
    const params = new URLSearchParams({
      lat:          String(lat),
      lng:          String(lon),
      username:     username,
      maxRows:      "10",
      radius:       "20",
      type:         "JSON",
      featureClass: "P",
    });
    const res  = await fetch(`${GEONAMES_BASE}/findNearbyPlaceNameJSON?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`GeoNames HTTP ${res.status}`);
    const json = await res.json() as GeonamesResponse;
    if (json.status) throw new Error(`GeoNames error: ${json.status.message}`);
    // Pick highest-population result — this is the enclosing city/metro area
    const entry = (json.geonames ?? [])
      .filter(g => g.population > 0)
      .sort((a, b) => b.population - a.population)[0] ?? null;

    if (!entry) {
      return {
        data: null,
        availability: { source, status: "unavailable", last_updated: now, expires_at: null, note: "No populated place found near coordinates" },
      };
    }

    return {
      data: {
        name:          entry.name,
        country_name:  entry.countryName,
        population:    entry.population || null,
        feature_class: entry.fcl,
        distance_km:   parseFloat(entry.distance) || null,
      },
      availability: {
        source,
        status:       "available",
        last_updated: now,
        expires_at:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
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
