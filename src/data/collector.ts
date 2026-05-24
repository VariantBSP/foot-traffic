import type { NormalizedAreaSignals, SourceAvailability, LocationResolution } from "../types/signals.js";
import { SignalCache, geocodeCacheKey, locationCacheKey } from "./cache.js";
import { loadDataSourceConfig, type DataSourceConfig } from "./config.js";
import { geocodeLocation, resolveCoordinates } from "./nominatim.js";
import { fetchOverpassSignals, fetchCompetitorCounts, configureOverpass } from "./overpass.js";
import { fetchReviewActivity } from "./google-places.js";
import { fetchPopulationSignal } from "./geonames.js";
import { fetchTransitSignals } from "./gtfs.js";
import { fetchPedestrianAccessibility } from "./openrouteservice.js";

// AreaSignals is an alias for NormalizedAreaSignals — used by the service layer
export type AreaSignals = NormalizedAreaSignals;

const DEFAULT_RADIUS = 500;

export class AreaSignalCollector {
  private readonly cache:  SignalCache;
  private readonly config: DataSourceConfig;

  constructor(config?: DataSourceConfig, cache?: SignalCache) {
    this.config = config ?? loadDataSourceConfig();
    this.cache  = cache  ?? new SignalCache(this.config.cacheDbPath);
    configureOverpass(this.config.overpassApiUrl);
  }

  // ── Primary collection method ─────────────────────────────────────────

  async collectAreaSignals(request: {
    location:      string | { lat: number; lon: number };
    businessType:  string | null;
    radiusMeters?: number;
  }): Promise<AreaSignals> {
    const radius = request.radiusMeters ?? DEFAULT_RADIUS;

    // Step 1: Resolve coordinates
    const { coordinates, label, geocodeAvailability } = await this.resolveLocation(request.location);
    if (!coordinates) {
      return emptySignals(locationLabel(request.location), radius, request.businessType, [geocodeAvailability]);
    }

    const { lat, lon } = coordinates;
    const cacheKey     = locationCacheKey(lat, lon, radius, request.businessType ?? "");

    // Step 2: Check cache for full normalized area signals
    const cached = this.cache.get<AreaSignals>(cacheKey, "normalized_area");
    if (cached) return cached.value;

    // Step 3: Fan out to all data sources in parallel
    const [overpass, reviews, population, transit, ors] = await Promise.all([
      this.cachedFetch(cacheKey, "osm_overpass",       () => fetchOverpassSignals(lat, lon, radius, request.businessType)),
      this.cachedFetch(cacheKey, "google_places",      () => fetchReviewActivity(lat, lon, radius, this.config.googlePlacesApiKey)),
      this.cachedFetch(cacheKey, "geonames",           () => fetchPopulationSignal(lat, lon, this.config.geonamesUsername)),
      this.cachedFetch(cacheKey, "gtfs",               () => fetchTransitSignals(lat, lon, radius)),
      this.cachedFetch(cacheKey, "openrouteservice",   () => fetchPedestrianAccessibility(lat, lon, this.config.openRouteServiceApiKey)),
    ]);

    const availability: SourceAvailability[] = [
      geocodeAvailability,
      overpass.availability,
      reviews.availability,
      population.availability,
      transit.availability,
      ors.availability,
    ];

    const sourceNotes: string[] = [];
    if (!this.config.googlePlacesApiKey)      sourceNotes.push("Review velocity signal unavailable — set GOOGLE_PLACES_API_KEY.");
    if (!this.config.geonamesUsername)         sourceNotes.push("Population signal unavailable — set GEONAMES_USERNAME (free at geonames.org).");
    if (!this.config.openRouteServiceApiKey)   sourceNotes.push("Walkability isochrones unavailable — set OPENROUTESERVICE_API_KEY (free at openrouteservice.org).");

    const normalized: AreaSignals = {
      location_label:            label,
      coordinates,
      radius_meters:             radius,
      business_type:             request.businessType,
      poi_counts:                overpass.data?.poi_counts             ?? null,
      pedestrian_infrastructure: overpass.data?.pedestrian_infrastructure ?? null,
      review_activity:           reviews.data,
      population:                population.data,
      competitor_counts:         overpass.data?.competitor_counts      ?? null,
      amenity_mix:               overpass.data?.amenity_mix            ?? null,
      transit:                   transit.data,
      pedestrian_accessibility:  ors.data,
      availability,
      source_notes:              sourceNotes,
    };

    // Cache the normalized area signals
    this.cache.set(cacheKey, "normalized_area", normalized);

    return normalized;
  }

  // ── Competitor-only collection (for get_competitor_density tool) ──────

  async collectCompetitorSignals(request: {
    location:     string | { lat: number; lon: number };
    businessType: string;
  }): Promise<Pick<AreaSignals, "location_label" | "coordinates" | "radius_meters" | "business_type" | "competitor_counts" | "availability" | "source_notes">> {
    const { coordinates, label, geocodeAvailability } = await this.resolveLocation(request.location);
    if (!coordinates) {
      return {
        location_label: locationLabel(request.location),
        coordinates:    null,
        radius_meters:  DEFAULT_RADIUS,
        business_type:  request.businessType,
        competitor_counts: null,
        availability:   [geocodeAvailability],
        source_notes:   ["Location could not be resolved to coordinates."],
      };
    }

    const { lat, lon } = coordinates;
    const cacheKey = locationCacheKey(lat, lon, 1000, `comp:${request.businessType}`);
    const result   = await this.cachedFetch(cacheKey, "osm_overpass", () => fetchCompetitorCounts(lat, lon, request.businessType));

    return {
      location_label:    label,
      coordinates,
      radius_meters:     DEFAULT_RADIUS,
      business_type:     request.businessType,
      competitor_counts: result.data,
      availability:      [geocodeAvailability, result.availability],
      source_notes:      [],
    };
  }

  close(): void {
    this.cache.close();
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async resolveLocation(
    location: string | { lat: number; lon: number },
  ): Promise<{ coordinates: { lat: number; lon: number } | null; label: string; geocodeAvailability: SourceAvailability }> {
    const now = new Date().toISOString();

    // If coordinates are passed directly, skip geocoding
    const direct = resolveCoordinates(location);
    if (direct) {
      return {
        coordinates: direct,
        label:       `${direct.lat.toFixed(4)}, ${direct.lon.toFixed(4)}`,
        geocodeAvailability: {
          source:       "nominatim",
          status:       "not_applicable",
          last_updated: now,
          expires_at:   null,
          note:         "Coordinates provided directly.",
        },
      };
    }

    // Geocode the location name with caching
    const query    = location as string;
    const geoKey   = geocodeCacheKey(query);
    const geoCache = this.cache.get<LocationResolution>(geoKey, "nominatim");

    if (geoCache) {
      return {
        coordinates: geoCache.value.coordinates,
        label:       geoCache.value.label,
        geocodeAvailability: {
          source:       "nominatim",
          status:       "available",
          last_updated: new Date(geoCache.cachedAt).toISOString(),
          expires_at:   new Date(geoCache.expiresAt).toISOString(),
          note:         "Served from cache.",
        },
      };
    }

    const geo = await geocodeLocation(query, this.config.nominatimUserAgent, this.config.nominatimBaseUrl);
    if (geo.data) this.cache.set(geoKey, "nominatim", geo.data);

    return {
      coordinates: geo.data?.coordinates ?? null,
      label:       geo.data?.label ?? query,
      geocodeAvailability: geo.availability,
    };
  }

  private async cachedFetch<T>(
    cacheKey: string,
    source:   string,
    fetcher:  () => Promise<{ data: T | null; availability: SourceAvailability }>,
  ): Promise<{ data: T | null; availability: SourceAvailability }> {
    const cached = this.cache.get<T>(`${cacheKey}:${source}`, source);
    if (cached) {
      return {
        data: cached.value,
        availability: {
          source:       source as SourceAvailability["source"],
          status:       "available",
          last_updated: new Date(cached.cachedAt).toISOString(),
          expires_at:   new Date(cached.expiresAt).toISOString(),
          note:         "Served from cache.",
        },
      };
    }

    const result = await fetcher();
    if (result.data !== null) {
      this.cache.set(`${cacheKey}:${source}`, source, result.data);
    }
    return result;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function locationLabel(location: string | { lat: number; lon: number }): string {
  if (typeof location === "string") return location;
  return `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
}

function emptySignals(
  label:        string,
  radius:       number,
  businessType: string | null,
  availability: SourceAvailability[],
): AreaSignals {
  return {
    location_label:            label,
    coordinates:               null,
    radius_meters:             radius,
    business_type:             businessType,
    poi_counts:                null,
    pedestrian_infrastructure: null,
    review_activity:           null,
    population:                null,
    competitor_counts:         null,
    amenity_mix:               null,
    transit:                   null,
    pedestrian_accessibility:  null,
    availability,
    source_notes:              ["Location could not be resolved to coordinates."],
  };
}
