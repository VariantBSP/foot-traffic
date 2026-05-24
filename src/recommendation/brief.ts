import type { SiteSignalScores } from "../types/scoring.js";
import type { RankedSiteBrief, SiteRecommendationBrief } from "../types/recommendation.js";

export interface RankedScoredSite {
  rank: number;
  site: SiteSignalScores;
}

export function buildSiteRecommendationBrief(site: SiteSignalScores): SiteRecommendationBrief {
  return buildComparisonRecommendationBrief([{ rank: 1, site }]);
}

export function buildComparisonRecommendationBrief(rankedSites: RankedScoredSite[]): SiteRecommendationBrief {
  const sorted = [...rankedSites].sort((left, right) => left.rank - right.rank);
  const rankedSiteBriefs = sorted.map((item) => buildRankedSiteBrief(item.rank, item.site));
  const winner = sorted[0]?.site;
  const runnerUp = sorted[1]?.site;
  const globalRiskFactors = unique(rankedSiteBriefs.flatMap((item) => item.risk_factors));
  const evidenceUsed = unique(sorted.flatMap((item) => evidenceForSite(item.site)));
  const limitations = unique(sorted.flatMap((item) => limitationsForSite(item.site)));

  if (winner === undefined) {
    return {
      brief_status: "complete",
      ranked_sites: [],
      recommendation: "No site recommendation is available because no scored sites were provided.",
      recommendation_rationale: "The recommendation layer requires scored public proxy signals before it can rank sites.",
      risk_factors: ["No scored sites were provided."],
      suggested_action: "Collect public proxy signals for at least one candidate site before making a site-selection decision.",
      evidence_used: [],
      limitations: ["No public proxy signals were available for synthesis."],
    };
  }

  return {
    brief_status: "complete",
    ranked_sites: rankedSiteBriefs,
    recommendation: recommendationForWinner(winner, runnerUp, sorted.length),
    recommendation_rationale: rationaleForWinner(winner, runnerUp),
    risk_factors: globalRiskFactors,
    suggested_action: suggestedActionForWinner(winner, runnerUp),
    evidence_used: evidenceUsed,
    limitations,
  };
}

function buildRankedSiteBrief(rank: number, site: SiteSignalScores): RankedSiteBrief {
  return {
    rank,
    location_label: site.location_label,
    composite_site_score: site.composite_site_score,
    competitor_saturation_label: site.competitor_saturation.label,
    key_strengths: strengthsForSite(site),
    risk_factors: risksForSite(site),
  };
}

function recommendationForWinner(winner: SiteSignalScores, runnerUp: SiteSignalScores | undefined, siteCount: number): string {
  if (winner.composite_site_score === null) {
    return `${winner.location_label} cannot be recommended from the current signal set because no weighted public proxy score could be calculated.`;
  }

  const role = siteRole(winner);
  if (siteCount === 1) {
    return `${winner.location_label} is a ${role} based on a composite public proxy signal score of ${winner.composite_site_score} out of 100.`;
  }

  if (runnerUp?.composite_site_score === null || runnerUp === undefined) {
    return `${winner.location_label} ranks first among the compared sites based on available public proxy signals.`;
  }

  const margin = winner.composite_site_score - runnerUp.composite_site_score;
  if (margin <= 3) {
    return `${winner.location_label} ranks slightly ahead of ${runnerUp.location_label}, but the difference is narrow and should be treated as directional.`;
  }

  return `${winner.location_label} ranks first among the compared sites and is the ${role} from the current scored public proxy signals.`;
}

function rationaleForWinner(winner: SiteSignalScores, runnerUp: SiteSignalScores | undefined): string {
  const strengths = strengthsForSite(winner);
  const strengthText =
    strengths.length > 0
      ? ` Its strongest drivers are ${joinHuman(strengths)}.`
      : " No individual signal is strong enough to call out as a clear driver.";
  const competitorText = ` Competitor saturation is ${winner.competitor_saturation.label}, with ${winner.competitor_saturation.count_500m} similar venues within 500 meters.`;
  const runnerText =
    runnerUp?.composite_site_score === null || runnerUp === undefined || winner.composite_site_score === null
      ? ""
      : ` It leads ${runnerUp.location_label} by ${winner.composite_site_score - runnerUp.composite_site_score} composite points.`;

  return `${winner.location_label} has a composite public proxy signal score of ${scoreText(winner.composite_site_score)}.${strengthText}${competitorText}${runnerText}`;
}

function suggestedActionForWinner(winner: SiteSignalScores, runnerUp: SiteSignalScores | undefined): string {
  if (winner.composite_site_score === null) {
    return "Treat this as an incomplete signal read and collect the unavailable weighted signals before prioritizing the site.";
  }

  if (winner.composite_site_score >= 75 && ["low", "moderate"].includes(winner.competitor_saturation.label)) {
    return runnerUp === undefined
      ? "Use this site as a priority pilot candidate, then validate lease, unit economics, zoning, and on-the-ground conditions outside this tool."
      : "Prioritize the top-ranked site for next-stage diligence, then validate lease, unit economics, zoning, and on-the-ground conditions outside this tool.";
  }

  if (winner.composite_site_score >= 75) {
    return "Treat the site as signal-strong but competition-sensitive; investigate competitor positioning before committing.";
  }

  if (winner.composite_site_score >= 50) {
    return "Use the site for further diligence rather than immediate prioritization; compare it with additional alternatives if available.";
  }

  return "Do not prioritize this site from current public proxy signals alone; collect stronger alternatives or wait for missing signals to become available.";
}

function siteRole(site: SiteSignalScores): string {
  if (site.composite_site_score === null) {
    return "partial-signal candidate";
  }

  if (site.composite_site_score >= 75 && ["low", "moderate"].includes(site.competitor_saturation.label)) {
    return "strong pilot or first-location candidate";
  }

  if (site.composite_site_score >= 75) {
    return "strong but competition-sensitive expansion candidate";
  }

  if (site.composite_site_score >= 50) {
    return "moderate candidate for further diligence";
  }

  return "low-priority candidate";
}

function strengthsForSite(site: SiteSignalScores): string[] {
  const strengths: string[] = [];
  for (const signal of site.signal_scores) {
    if (signal.score !== null && signal.score >= 70) {
      strengths.push(`${labelForSignal(signal.signal)} (${signal.score}/100)`);
    }
  }

  if (["low", "moderate"].includes(site.competitor_saturation.label)) {
    strengths.push(`${site.competitor_saturation.label} competitor saturation`);
  }

  if (!site.inferred_peak_hours.includes("insufficient public signal for peak-hour inference")) {
    strengths.push(`inferred activity windows: ${site.inferred_peak_hours.join(", ")}`);
  }

  return strengths;
}

function risksForSite(site: SiteSignalScores): string[] {
  const risks: string[] = [];
  for (const signal of site.signal_scores) {
    if (signal.score !== null && signal.score < 40) {
      risks.push(`${labelForSignal(signal.signal)} is weak (${signal.score}/100).`);
    }
    if (signal.score === null || signal.status !== "available") {
      risks.push(`${labelForSignal(signal.signal)} is ${signal.status}.`);
    }
  }

  if (["high", "saturated"].includes(site.competitor_saturation.label)) {
    risks.push(`Competitor saturation is ${site.competitor_saturation.label} within 500 meters.`);
  }

  if (site.composite_site_score === null) {
    risks.push("Composite score is unavailable because no weighted signals were usable.");
  }

  return unique(risks);
}

function evidenceForSite(site: SiteSignalScores): string[] {
  const evidence = site.signal_scores
    .filter((signal) => signal.score !== null)
    .map((signal) => `${labelForSignal(signal.signal)} score ${signal.score}/100`);
  evidence.push(`Competitor saturation ${site.competitor_saturation.label} (${site.competitor_saturation.count_500m} similar venues within 500 meters)`);

  if (site.inferred_peak_hours.length > 0) {
    evidence.push(`Inferred peak-hour windows: ${site.inferred_peak_hours.join(", ")}`);
  }

  return evidence;
}

function limitationsForSite(site: SiteSignalScores): string[] {
  const limitations = site.signal_scores
    .filter((signal) => signal.score === null || signal.status !== "available")
    .map((signal) => `${labelForSignal(signal.signal)} was ${signal.status}${signal.note === null ? "" : `: ${signal.note}`}`);

  if (site.scoring_notes.length > 0) {
    limitations.push(...site.scoring_notes);
  }

  limitations.push("This recommendation uses public proxy signals, not exact foot-traffic counts or mobile-device visit data.");
  limitations.push("This output does not replace lease, zoning, legal, financial, or on-the-ground diligence.");

  return unique(limitations);
}

function labelForSignal(signal: string): string {
  switch (signal) {
    case "poi_density":
      return "POI density";
    case "pedestrian_infrastructure":
      return "pedestrian infrastructure";
    case "review_velocity":
      return "review velocity";
    case "population_density":
      return "population density";
    default:
      return signal;
  }
}

function scoreText(score: number | null): string {
  return score === null ? "unavailable" : `${score} out of 100`;
}

function joinHuman(items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return items[0] as string;
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
