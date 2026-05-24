import { COMPOSITE_WEIGHTS, DEFAULT_SCORING_BENCHMARKS } from "./config.js";
import { scoreCompetitorSaturation } from "./competitors.js";
import { inferPeakHours } from "./peak-hours.js";
import { scoreByBenchmark, weightedAverage } from "./normalize.js";
import type { AvailabilityStatus, NormalizedAreaSignals, SourceAvailability } from "../types/signals.js";
import type { ScoringBenchmarks, SignalName, SignalScore, SiteSignalScores } from "../types/scoring.js";

export interface ScoreAreaSignalsOptions {
  benchmarks?: ScoringBenchmarks;
}

export function scoreAreaSignals(
  signals: NormalizedAreaSignals,
  options: ScoreAreaSignalsOptions = {},
): SiteSignalScores {
  const benchmarks = options.benchmarks ?? DEFAULT_SCORING_BENCHMARKS;
  const scoringNotes: string[] = [];
  const signalScores: SignalScore[] = [
    scorePoiDensity(signals, benchmarks),
    scorePedestrianInfrastructure(signals, benchmarks),
    scoreReviewVelocity(signals, benchmarks),
    scorePopulationDensity(signals, benchmarks),
  ];
  const weightedInputs = signalScores
    .filter((item): item is SignalScore & { score: number } => item.score !== null && item.status === "available")
    .map((item) => ({
      score: item.score,
      weight: item.weight,
      signal: item.signal,
    }));

  const missingWeightedSignals = signalScores.filter((item) => item.score === null || item.status !== "available");
  if (missingWeightedSignals.length > 0) {
    scoringNotes.push(
      `Composite score recalculated from available weighted signals; omitted: ${missingWeightedSignals
        .map((item) => item.signal)
        .join(", ")}.`,
    );
  }

  const composite = weightedAverage(weightedInputs);
  if (composite === null) {
    scoringNotes.push("Composite score unavailable because no weighted signals were available.");
  }

  const peakHours = inferPeakHours(signals);
  const competitorSaturation = scoreCompetitorSaturation(signals.competitor_counts);

  return {
    location_label: signals.location_label,
    business_type: signals.business_type,
    radius_meters: signals.radius_meters,
    poi_density_score: signalScoreValue(signalScores, "poi_density"),
    pedestrian_infrastructure_score: signalScoreValue(signalScores, "pedestrian_infrastructure"),
    review_velocity_score: signalScoreValue(signalScores, "review_velocity"),
    population_density_score: signalScoreValue(signalScores, "population_density"),
    competitor_saturation: competitorSaturation,
    inferred_peak_hours: peakHours.windows,
    peak_hour_evidence: peakHours.evidence,
    composite_site_score: composite,
    weighted_signals_used: weightedInputs.map((item) => item.signal),
    signal_scores: signalScores,
    signal_availability: signals.availability,
    scoring_notes: scoringNotes,
  };
}

function scorePoiDensity(signals: NormalizedAreaSignals, benchmarks: ScoringBenchmarks): SignalScore {
  const sourceAvailability = availabilityFor(signals, "osm_overpass");
  const status = signalStatus(sourceAvailability, signals.poi_counts);
  if (signals.poi_counts === null || status !== "available") {
    return unavailableSignal("poi_density", COMPOSITE_WEIGHTS.poi_density, status, sourceAvailability);
  }

  const count = Object.values(signals.poi_counts).reduce((sum, value) => sum + value, 0);
  return {
    signal: "poi_density",
    score: scoreByBenchmark(count, benchmarks.poiCountForMaxScore),
    status,
    weight: COMPOSITE_WEIGHTS.poi_density,
    note: `Based on ${count} OpenStreetMap POIs within ${signals.radius_meters} meters.`,
  };
}

function scorePedestrianInfrastructure(signals: NormalizedAreaSignals, benchmarks: ScoringBenchmarks): SignalScore {
  const sourceAvailability = availabilityFor(signals, "osm_overpass");
  const status = signalStatus(sourceAvailability, signals.pedestrian_infrastructure);
  if (signals.pedestrian_infrastructure === null || status !== "available") {
    return unavailableSignal(
      "pedestrian_infrastructure",
      COMPOSITE_WEIGHTS.pedestrian_infrastructure,
      status,
      sourceAvailability,
    );
  }

  const infrastructure = signals.pedestrian_infrastructure;
  const footwayScore = scoreByBenchmark(
    infrastructure.footway_length_meters,
    benchmarks.pedestrian.footwayMetersForMaxScore,
  );
  const crosswalkScore = scoreByBenchmark(
    infrastructure.crosswalk_count,
    benchmarks.pedestrian.crosswalksForMaxScore,
  );
  const transitStopScore = scoreByBenchmark(
    infrastructure.transit_stop_count,
    benchmarks.pedestrian.transitStopsForMaxScore,
  );

  return {
    signal: "pedestrian_infrastructure",
    score: Math.round(footwayScore * 0.45 + crosswalkScore * 0.3 + transitStopScore * 0.25),
    status,
    weight: COMPOSITE_WEIGHTS.pedestrian_infrastructure,
    note: "Based on OSM footway length, crosswalk nodes, and transit stop count.",
  };
}

function scoreReviewVelocity(signals: NormalizedAreaSignals, benchmarks: ScoringBenchmarks): SignalScore {
  const sourceAvailability = availabilityFor(signals, "google_places");
  const status = signalStatus(sourceAvailability, signals.review_activity);
  if (signals.review_activity === null || status !== "available") {
    return unavailableSignal("review_velocity", COMPOSITE_WEIGHTS.review_velocity, status, sourceAvailability);
  }

  const reviewActivity = signals.review_activity;
  const volumeScore = scoreByBenchmark(
    reviewActivity.total_reviews,
    benchmarks.review.totalReviewsForMaxScore,
  );
  const recencyScore =
    reviewActivity.recent_reviews_90d === null
      ? null
      : scoreByBenchmark(reviewActivity.recent_reviews_90d, benchmarks.review.recentReviews90dForMaxScore);
  const score = recencyScore === null ? volumeScore : Math.round(volumeScore * 0.7 + recencyScore * 0.3);

  return {
    signal: "review_velocity",
    score,
    status,
    weight: COMPOSITE_WEIGHTS.review_velocity,
    note:
      recencyScore === null
        ? "Based on Google Places review volume; detailed review recency unavailable."
        : "Based on Google Places review volume and reviews in the last 90 days.",
  };
}

function scorePopulationDensity(signals: NormalizedAreaSignals, benchmarks: ScoringBenchmarks): SignalScore {
  const sourceAvailability = availabilityFor(signals, "geonames");
  const status = signalStatus(sourceAvailability, signals.population);
  if (signals.population === null || signals.population.population === null || status !== "available") {
    return unavailableSignal("population_density", COMPOSITE_WEIGHTS.population_density, status, sourceAvailability);
  }

  return {
    signal: "population_density",
    score: scoreByBenchmark(signals.population.population, benchmarks.populationForMaxScore),
    status,
    weight: COMPOSITE_WEIGHTS.population_density,
    note: `Based on GeoNames population for ${signals.population.name}.`,
  };
}

function signalScoreValue(signalScores: SignalScore[], signal: SignalName): number | null {
  return signalScores.find((item) => item.signal === signal)?.score ?? null;
}

function availabilityFor(signals: NormalizedAreaSignals, source: SourceAvailability["source"]): SourceAvailability | null {
  return signals.availability.find((item) => item.source === source) ?? null;
}

function signalStatus(sourceAvailability: SourceAvailability | null, value: unknown): AvailabilityStatus {
  if (sourceAvailability === null) {
    return value === null ? "unavailable" : "available";
  }
  if (sourceAvailability.status !== "available") {
    return sourceAvailability.status;
  }
  if (value === null || value === undefined) {
    return "unavailable";
  }

  return "available";
}

function unavailableSignal(
  signal: SignalName,
  weight: number,
  status: AvailabilityStatus,
  sourceAvailability: SourceAvailability | null,
): SignalScore {
  return {
    signal,
    score: null,
    status,
    weight,
    note: sourceAvailability?.note ?? "Signal unavailable.",
  };
}
