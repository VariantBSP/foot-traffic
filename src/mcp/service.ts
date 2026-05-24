import { AreaSignalCollector, type AreaSignals } from "../data/index.js";
import { buildComparisonRecommendationBrief, buildSiteRecommendationBrief } from "../recommendation/index.js";
import { scoreAreaSignals } from "../scoring/index.js";
import { scoreCompetitorSaturation } from "../scoring/competitors.js";
import type {
  CompareSitesInput,
  CompareSitesOutput,
  GetAreaSignalsInput,
  GetAreaSignalsOutput,
  GetCompetitorDensityInput,
  GetCompetitorDensityOutput,
  GetSiteIntelligenceInput,
  GetSiteIntelligenceOutput,
} from "./schemas.js";

const CONTEXT_PROTOCOL_MAX_LATENCY_MS = 60_000;
const RADIUS_BANDS_METERS: [250, 500, 1000] = [250, 500, 1_000];

export interface SiteSignalToolServiceOptions {
  collector?: CollectorLike;
}

interface CollectorLike {
  collectAreaSignals(request: {
    location: GetSiteIntelligenceInput["location"];
    businessType: string | null;
    radiusMeters?: number;
  }): Promise<AreaSignals>;
  collectCompetitorSignals(request: {
    location: GetSiteIntelligenceInput["location"];
    businessType: string;
  }): Promise<Pick<
    AreaSignals,
    | "location_label"
    | "coordinates"
    | "radius_meters"
    | "business_type"
    | "competitor_counts"
    | "availability"
    | "source_notes"
  >>;
  close(): void;
}

export class SiteSignalToolService {
  private readonly collector: CollectorLike;

  constructor(options: SiteSignalToolServiceOptions = {}) {
    this.collector = options.collector ?? new AreaSignalCollector();
  }

  async getSiteIntelligence(input: GetSiteIntelligenceInput): Promise<GetSiteIntelligenceOutput> {
    return this.measure(async (startedAt) => {
      const evidence = await this.collector.collectAreaSignals({
        location: input.location,
        businessType: input.business_type,
        radiusMeters: input.radius_meters,
      });
      const site = scoreAreaSignals(evidence);

      return {
        method: "get_site_intelligence",
        site,
        evidence,
        brief: buildSiteRecommendationBrief(site),
        latency_ms: latency(startedAt),
      };
    });
  }

  async compareSites(input: CompareSitesInput): Promise<CompareSitesOutput> {
    return this.measure(async (startedAt) => {
      const evaluated = await Promise.all(
        input.locations.map(async (location) => {
          const evidence = await this.collector.collectAreaSignals({
            location,
            businessType: input.business_type,
            radiusMeters: input.radius_meters,
          });
          return {
            site: scoreAreaSignals(evidence),
            evidence,
          };
        }),
      );

      const ranked = evaluated
        .sort((left, right) => (right.site.composite_site_score ?? -1) - (left.site.composite_site_score ?? -1))
        .map((item, index) => ({
          rank: index + 1,
          ...item,
        }));

      return {
        method: "compare_sites",
        ranked_sites: ranked,
        brief: buildComparisonRecommendationBrief(ranked),
        latency_ms: latency(startedAt),
      };
    });
  }

  async getAreaSignals(input: GetAreaSignalsInput): Promise<GetAreaSignalsOutput> {
    return this.measure(async (startedAt) => ({
      method: "get_area_signals",
      area: await this.collector.collectAreaSignals({
        location: input.location,
        businessType: null,
        radiusMeters: input.radius_meters,
      }),
      latency_ms: latency(startedAt),
    }));
  }

  async getCompetitorDensity(input: GetCompetitorDensityInput): Promise<GetCompetitorDensityOutput> {
    return this.measure(async (startedAt) => {
      const area = await this.collector.collectCompetitorSignals({
        location: input.location,
        businessType: input.business_category,
      });

      return {
        method: "get_competitor_density",
        location_label: area.location_label,
        coordinates: area.coordinates,
        business_category: input.business_category,
        radius_bands_meters: RADIUS_BANDS_METERS,
        competitor_saturation: scoreCompetitorSaturation(area.competitor_counts),
        availability: area.availability,
        source_notes: area.source_notes,
        latency_ms: latency(startedAt),
      };
    });
  }

  close(): void {
    this.collector.close();
  }

  private async measure<T extends { latency_ms: number }>(
    run: (startedAt: number) => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    const result = await run(startedAt);
    if (result.latency_ms > CONTEXT_PROTOCOL_MAX_LATENCY_MS) {
      return {
        ...result,
        latency_ms: result.latency_ms,
      };
    }

    return result;
  }
}

function latency(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export type SiteSignalAreaEvidence = AreaSignals;
