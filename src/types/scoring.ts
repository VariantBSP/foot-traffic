import type { AvailabilityStatus, SourceAvailability } from "./signals.js";

export type SignalName =
  | "poi_density"
  | "pedestrian_infrastructure"
  | "review_velocity"
  | "population_density";

export type CompetitorSaturationLabel = "low" | "moderate" | "high" | "saturated";

export interface SignalScore {
  signal: SignalName;
  score: number | null;
  status: AvailabilityStatus;
  weight: number;
  note: string | null;
}

export interface CompetitorSaturationScore {
  count_250m: number;
  count_500m: number;
  count_1000m: number;
  label: CompetitorSaturationLabel;
}

export interface PeakHourInference {
  windows: string[];
  evidence: string[];
}

export interface SiteSignalScores {
  location_label: string;
  business_type: string | null;
  radius_meters: number;
  poi_density_score: number | null;
  pedestrian_infrastructure_score: number | null;
  review_velocity_score: number | null;
  population_density_score: number | null;
  competitor_saturation: CompetitorSaturationScore;
  inferred_peak_hours: string[];
  peak_hour_evidence: string[];
  composite_site_score: number | null;
  weighted_signals_used: SignalName[];
  signal_scores: SignalScore[];
  signal_availability: SourceAvailability[];
  scoring_notes: string[];
}

export interface ScoringBenchmarks {
  poiCountForMaxScore: number;
  pedestrian: {
    footwayMetersForMaxScore: number;
    crosswalksForMaxScore: number;
    transitStopsForMaxScore: number;
  };
  review: {
    totalReviewsForMaxScore: number;
    recentReviews90dForMaxScore: number;
  };
  populationForMaxScore: number;
}
