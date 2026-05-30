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
    // findNearbyPlaceNameJSON with cities=cities5000 filters out places with
    // population < 5000 before sorting by distance. Without this, African and
    // developing-world queries return dozens of unmapped neighborhood stubs with
    // population=0, burying the actual city (Lagos at 8M, Nairobi at 4M, etc.)
    // below the maxRows cutoff. cities5000 ensures every result has real data.
    // 50km radius catches the enclosing metro even from suburban coordinates.
    const params = new URLSearchParams({
      lat:      String(lat),
      lng:      String(lon),
      username: username,
      maxRows:  "5",
      cities:   "cities5000",
      radius:   "50",
      type:     "JSON",
    });
    const res  = await fetch(`${GEONAMES_BASE}/findNearbyPlaceNameJSON?${params}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`GeoNames HTTP ${res.status}`);
    const json = await res.json() as GeonamesResponse;
    if (json.status) throw new Error(`GeoNames error: ${json.status.message}`);

    // Nearest city with ≥5000 population — represents the local area this site
    // belongs to, not the entire metro. Sorting by distance (not population)
    // means Yaba returns a Yaba-level entry if one exists in GeoNames, not
    // Lagos (15M) which overstates local density and gives every Lagos location
    // an identical 100/100 score regardless of actual neighbourhood character.
    const entry = (json.geonames ?? [])
      .filter(g => g.population > 0)
      .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance))[0] ?? null;

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