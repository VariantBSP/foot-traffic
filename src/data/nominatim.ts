import type { DataResult, LocationResolution } from "../types/signals.js";

// ── Rate limiter ──────────────────────────────────────────────────────────
// Nominatim ToS: max 1 request per second, valid User-Agent required.

let lastRequestAt = 0;

async function rateLimitedFetch(url: string, userAgent: string): Promise<Response> {
  const wait = Math.max(0, lastRequestAt + 1_100 - Date.now());
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
  return fetch(url, {
    signal:  AbortSignal.timeout(8_000),
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
}

interface NominatimResult {
  place_id:     string;
  lat:          string;
  lon:          string;
  display_name: string;
  class:        string;
  type:         string;
  importance:   number;
}

// ── Primary: Nominatim ────────────────────────────────────────────────────

async function geocodeViaNominatim(
  query:     string,
  userAgent: string,
  baseUrl:   string,
): Promise<{ lat: number; lon: number; label: string } | null> {
  // addressdetails=1 returns the full address breakdown (suburb, neighbourhood,
  // city_district etc.) which lets us derive a correct human-readable label
  // even when the top result is a POI. e.g. "Yaba, Lagos" resolves to
  // "Yaba College of Technology" (the only high-importance Nominatim entry
  // for that query) but its address.suburb = "Yaba" — the correct label.
  const params = new URLSearchParams({
    q:              query,
    format:         "json",
    limit:          "5",
    addressdetails: "0",
  });

  let res = await rateLimitedFetch(`${baseUrl}/search?${params}`, userAgent);
  if (res.status === 403) {
    await new Promise(r => setTimeout(r, 2_000));
    res = await rateLimitedFetch(`${baseUrl}/search?${params}`, userAgent);
  }
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

  const results = await res.json() as NominatimResult[];

  const AREA_CLASSES = new Set(["place", "boundary", "landuse"]);
  const AREA_TYPES   = new Set([
    "administrative", "suburb", "neighbourhood", "quarter",
    "city", "town", "village", "hamlet", "municipality",
    "island", "county", "state", "country", "district",
  ]);

  function rankResult(r: NominatimResult): number {
    const classScore = AREA_CLASSES.has(r.class) ? 20 : 0;
    const typeScore  = AREA_TYPES.has(r.type)    ? 10 : 0;
    return classScore + typeScore + (r.importance ?? 0);
  }

  const best = [...results].sort((a, b) => rankResult(b) - rankResult(a))[0];
  if (!best) return null;

  // Label extraction:
  // - If Nominatim returned an actual area (suburb, city, neighbourhood, etc.),
  //   its own display_name first component is correct.
  // - If Nominatim returned a POI or institution (college, bridge, station...),
  //   the user's query first term is correct. "Yaba, Lagos" → "Yaba", not
  //   "Yaba College of Technology" or "Ebute-Metta" (address.suburb).
  const queryFirstTerm = query.split(",")[0]?.trim() ?? query;
  const label = AREA_TYPES.has(best.type)
    ? (best.display_name.split(",")[0]?.trim() ?? queryFirstTerm)
    : queryFirstTerm;

  return {
    lat:   parseFloat(best.lat),
    lon:   parseFloat(best.lon),
    label,
  };
}

// ── Fallback: Photon (Komoot) ─────────────────────────────────────────────
// Free, no auth, no hard rate limit, global OSM coverage.
// Used when Nominatim returns 403 or no results.

interface PhotonFeature {
  geometry:   { coordinates: [number, number] };
  properties: { name?: string; city?: string; country?: string };
}

async function geocodeViaPhoton(
  query: string,
): Promise<{ lat: number; lon: number; label: string } | null> {
  const params = new URLSearchParams({ q: query, limit: "3", lang: "en" });
  const res    = await fetch(`https://photon.komoot.io/api/?${params}`, {
    signal:  AbortSignal.timeout(8_000),
    headers: { Accept: "application/json", "User-Agent": "SiteSignalMCP/1.0" },
  });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const json = await res.json() as { features?: PhotonFeature[] };
  const feat  = json.features?.[0];
  if (!feat) return null;

  const [lon, lat] = feat.geometry.coordinates;
  const label = feat.properties.name ?? feat.properties.city ?? query;
  return { lat, lon, label };
}

// ── Public API ────────────────────────────────────────────────────────────

export async function geocodeLocation(
  query:     string,
  userAgent: string,
  baseUrl    = "https://nominatim.openstreetmap.org",
): Promise<DataResult<LocationResolution>> {
  const source = "nominatim" as const;
  const now    = new Date().toISOString();

  // Try Nominatim first, fall back to Photon on failure
  let result: { lat: number; lon: number; label: string } | null = null;
  let errorNote: string | null = null;

  try {
    result = await geocodeViaNominatim(query, userAgent, baseUrl);
  } catch (err) {
    errorNote = err instanceof Error ? err.message : String(err);
  }

  if (!result) {
    try {
      result = await geocodeViaPhoton(query);
      errorNote = errorNote ? `Nominatim: ${errorNote} — used Photon fallback` : null;
    } catch (err2) {
      return {
        data: null,
        availability: {
          source, status: "unavailable", last_updated: now, expires_at: null,
          note: `${errorNote ?? "Nominatim failed"}; Photon: ${err2 instanceof Error ? err2.message : String(err2)}`,
        },
      };
    }
  }

  if (!result) {
    return {
      data: null,
      availability: {
        source, status: "unavailable", last_updated: now, expires_at: null,
        note: errorNote ?? `No geocode result for "${query}"`,
      },
    };
  }

  return {
    data: {
      label:           result.label,
      coordinates:     { lat: result.lat, lon: result.lon },
      source_place_id: null,
      raw_type:        null,
      importance:      null,
    },
    availability: {
      source, status: "available", last_updated: now,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      note: errorNote,
    },
  };
}

export function resolveCoordinates(
  location: unknown,
): { lat: number; lon: number } | null {
  if (typeof location !== "object" || location === null) return null;
  const obj = location as Record<string, unknown>;
  const lat  = obj["lat"];
  const lon  = obj["lon"];
  if (typeof lat === "number" && typeof lon === "number" && isFinite(lat) && isFinite(lon)) {
    return { lat, lon };
  }
  return null;
}