import type { CompetitorCounts } from "../types/signals.js";
import type { CompetitorSaturationLabel, CompetitorSaturationScore } from "../types/scoring.js";

export function scoreCompetitorSaturation(counts: CompetitorCounts | null): CompetitorSaturationScore {
  const count250 = counts?.within_250m ?? 0;
  const count500 = counts?.within_500m ?? 0;
  const count1000 = counts?.within_1000m ?? 0;

  return {
    count_250m: count250,
    count_500m: count500,
    count_1000m: count1000,
    label: labelFrom500mCount(count500),
  };
}

export function labelFrom500mCount(count500m: number): CompetitorSaturationLabel {
  if (count500m >= 20) {
    return "saturated";
  }
  if (count500m >= 10) {
    return "high";
  }
  if (count500m >= 4) {
    return "moderate";
  }

  return "low";
}
