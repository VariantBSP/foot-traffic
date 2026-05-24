import type { CompetitorSaturationLabel } from "./scoring.js";

export type BriefStatus = "complete";

export interface RankedSiteBrief {
  rank: number;
  location_label: string;
  composite_site_score: number | null;
  competitor_saturation_label: CompetitorSaturationLabel;
  key_strengths: string[];
  risk_factors: string[];
}

export interface SiteRecommendationBrief {
  brief_status: BriefStatus;
  ranked_sites: RankedSiteBrief[];
  recommendation: string;
  recommendation_rationale: string;
  risk_factors: string[];
  suggested_action: string;
  evidence_used: string[];
  limitations: string[];
}
