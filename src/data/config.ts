import "dotenv/config";

export interface DataSourceConfig {
  cacheDbPath:             string;
  googlePlacesApiKey:      string | null; // GOOGLE_PLACES_API_KEY
  geonamesUsername:        string | null; // GEONAMES_USERNAME (free at geonames.org)
  openRouteServiceApiKey:  string | null; // OPENROUTESERVICE_API_KEY (free at openrouteservice.org)
  nominatimUserAgent:      string;        // NOMINATIM_USER_AGENT (required by Nominatim ToS)
  nominatimBaseUrl:        string;        // NOMINATIM_BASE_URL (default: nominatim.openstreetmap.org)
  overpassApiUrl:          string | null; // OVERPASS_API_URL — optional mirror or self-hosted instance
  gtfsFeedUrls:            string[];      // GTFS_FEED_URLS — comma-separated feed zip URLs
}

export function loadDataSourceConfig(): DataSourceConfig {
  return {
    cacheDbPath:            process.env["CACHE_DB_PATH"]            ?? "./data/cache.sqlite",
    googlePlacesApiKey:     process.env["GOOGLE_PLACES_API_KEY"]   ?? null,
    geonamesUsername:       process.env["GEONAMES_USERNAME"]        ?? null,
    openRouteServiceApiKey: process.env["OPENROUTESERVICE_API_KEY"] ?? null,
    nominatimUserAgent:     process.env["NOMINATIM_USER_AGENT"]    ?? "SiteSignalMCP/1.0 (contact@example.com)",
    nominatimBaseUrl:       process.env["NOMINATIM_BASE_URL"]      ?? "https://nominatim.openstreetmap.org",
    overpassApiUrl:         process.env["OVERPASS_API_URL"]         ?? null,
    gtfsFeedUrls:           (process.env["GTFS_FEED_URLS"] ?? "")
                              .split(",")
                              .map(s => s.trim())
                              .filter(Boolean),
  };
}
