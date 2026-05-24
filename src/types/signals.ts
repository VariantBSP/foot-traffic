export type SourceName =
  | "nominatim"
  | "osm_overpass"
  | "google_places"
  | "geonames"
  | "gtfs"
  | "openrouteservice";

export type AvailabilityStatus =
  | "available"
  | "unavailable"
  | "stale"
  | "quota_limited"
  | "not_applicable";

export interface SourceAvailability {
  source: SourceName;
  status: AvailabilityStatus;
  last_updated: string | null;
  expires_at: string | null;
  note: string | null;
}

export interface DataResult<T> {
  data: T | null;
  availability: SourceAvailability;
}

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface LocationResolution {
  label: string;
  coordinates: Coordinates;
  source_place_id: string | null;
  raw_type: string | null;
  importance: number | null;
}

export interface PedestrianInfrastructure {
  footway_length_meters: number;
  crosswalk_count: number;
  transit_stop_count: number;
  building_footprint_count: number;
}

export interface CompetitorCounts {
  within_250m: number;
  within_500m: number;
  within_1000m: number;
}

export interface OverpassSignals {
  poi_counts: Record<string, number>;
  amenity_mix: Record<string, number>;
  pedestrian_infrastructure: PedestrianInfrastructure;
  competitor_counts: CompetitorCounts;
  raw_element_count: number;
}

export interface ReviewVenue {
  id: string;
  name: string;
  rating: number | null;
  review_count: number;
  types: string[];
  most_recent_review_at: string | null;
}

export interface ReviewActivity {
  total_reviews: number;
  venue_count: number;
  venues_with_reviews: number;
  recent_reviews_90d: number | null;
  review_recency_available: boolean;
  representative_venues: ReviewVenue[];
}

export interface PopulationSignal {
  name: string;
  country_name: string | null;
  population: number | null;
  feature_class: string | null;
  distance_km: number | null;
}

export interface GtfsFeedSignals {
  feed_url: string;
  stop_count: number;
  service_events_by_hour: Record<string, number>;
}

export interface TransitSignals {
  feed_count: number;
  stop_count: number;
  service_events_by_hour: Record<string, number>;
  feeds: GtfsFeedSignals[];
}

export interface IsochroneFeatureSummary {
  range_seconds: number | null;
  area_square_meters: number | null;
}

export interface PedestrianAccessibility {
  profile: "foot-walking";
  ranges_seconds: number[];
  isochrone_count: number;
  features: IsochroneFeatureSummary[];
}

export interface WalkingRouteSummary {
  distance_meters: number | null;
  duration_seconds: number | null;
}

export interface NormalizedAreaSignals {
  location_label: string;
  coordinates: Coordinates | null;
  radius_meters: number;
  business_type: string | null;
  poi_counts: Record<string, number> | null;
  pedestrian_infrastructure: PedestrianInfrastructure | null;
  review_activity: ReviewActivity | null;
  population: PopulationSignal | null;
  competitor_counts: CompetitorCounts | null;
  amenity_mix: Record<string, number> | null;
  transit: TransitSignals | null;
  pedestrian_accessibility: PedestrianAccessibility | null;
  availability: SourceAvailability[];
  source_notes: string[];
}
