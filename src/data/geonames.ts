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
    // findNearbyPlaceName returns the nearest populated place
    const params = new URLSearchParams({
      lat:      String(lat),
      lng:      String(lon),
      username: username,
      maxRows:  "5",
      type:     "JSON",
      featureClass: "P", // populated places only
    });

    const res  = await fetch(`${GEONAMES_BASE}/findNearbyPlaceNameJSON?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`GeoNames HTTP ${res.status}`);
    const json = await res.json() as GeonamesResponse;

    if (json.status) throw new Error(`GeoNames error: ${json.status.message}`);

    // Pick the nearest entry with a non-zero population
    const entry = (json.geonames ?? []).find(g => g.population > 0) ?? json.geonames?.[0];

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
