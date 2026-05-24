import type { ScoringBenchmarks } from "../types/scoring.js";

export const COMPOSITE_WEIGHTS = {
  poi_density: 0.25,
  pedestrian_infrastructure: 0.25,
  review_velocity: 0.3,
  population_density: 0.2,
} as const;

export const DEFAULT_SCORING_BENCHMARKS: ScoringBenchmarks = {
  poiCountForMaxScore: 120,
  pedestrian: {
    footwayMetersForMaxScore: 2_000,
    crosswalksForMaxScore: 20,
    transitStopsForMaxScore: 10,
  },
  review: {
    totalReviewsForMaxScore: 3_000,
    recentReviews90dForMaxScore: 20,
  },
  populationForMaxScore: 1_000_000,
};
