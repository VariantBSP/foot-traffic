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
  type:         string;
  importance:   number;
}

// ── Primary: Nominatim ────────────────────────────────────────────────────

async function geocodeViaNominatim(
  query:     string,
  userAgent: string,
  baseUrl:   string,
): Promise<{ lat: number; lon: number; label: string } | null> {
  const params = new URLSearchParams({ q: query, format: "json", limit: "5", addressdetails: "0" });
  let res = await rateLimitedFetch(`${baseUrl}/search?${params}`, userAgent);

  // Nominatim returns 403 when rate-limited. Back off 2 seconds and retry once.
  if (res.status === 403) {
    await new Promise(r => setTimeout(r, 2_000));
    res = await rateLimitedFetch(`${baseUrl}/search?${params}`, userAgent);
  }

  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const results = await res.json() as NominatimResult[];
  const best    = [...results].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))[0];
  if (!best) return null;

  const AREA_TYPES = new Set([
    "administrative", "suburb", "neighbourhood", "quarter",
    "city", "town", "village", "hamlet", "municipality",
    "island", "county", "state", "country", "district",
  ]);

  // If Nominatim returns a specific business/POI (low importance or non-area type),
  // keep the coordinates but use the original query as the human-readable label.
  const label = (best.importance > 0.3 || AREA_TYPES.has(best.type))
    ? (best.display_name.split(",")[0]?.trim() ?? query)
    : query;

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
  location: string | { lat: number; lon: number },
): { lat: number; lon: number } | null {
  if (typeof location === "object" && "lat" in location && "lon" in location) {
    return { lat: location.lat, lon: location.lon };
  }
  return null;
}
