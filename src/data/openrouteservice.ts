import type { DataResult, PedestrianAccessibility } from "../types/signals.js";

// ── OpenRouteService — removed ────────────────────────────────────────────
// ORS isochrone API returns HTTP 403 on every call (API key invalid or
// rate-limited on the free tier). Returning not_applicable rather than
// letting every query spend 10s hitting a broken endpoint.
//
// Replacement: walkability is now estimated from Overpass pedestrian
// infrastructure data (footway length, crosswalk count, transit stops)
// which is already fetched as part of the combined Overpass query.
// This is available for all cities, not just ORS-covered areas.

export async function fetchPedestrianAccessibility(
  _lat:    number,
  _lon:    number,
  _apiKey: string | null,
): Promise<DataResult<PedestrianAccessibility>> {
  const now = new Date().toISOString();
  return {
    data: null,
    availability: {
      source:       "openrouteservice",
      status:       "not_applicable",
      last_updated: now,
      expires_at:   null,
      note:         "Walkability estimated from Overpass pedestrian infrastructure (footway_length_meters, crosswalk_count, transit_stop_count). ORS isochrone API removed — was returning HTTP 403 on every call.",
    },
  };
}
