import { z } from "zod";

export const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const LocationInputSchema = z.union([
  z.string().min(1).describe("Location name, address, neighborhood, district, or place name."),
  CoordinatesSchema.describe("Latitude and longitude for a candidate site."),
]);

export const RadiusMetersSchema = z.number().int().min(100).max(5_000).default(500);

export const SourceAvailabilitySchema = z.object({
  source: z.enum(["nominatim", "osm_overpass", "google_places", "geonames", "gtfs", "openrouteservice"]),
  status: z.enum(["available", "unavailable", "stale", "quota_limited", "not_applicable"]),
  last_updated: z.string().nullable(),
  expires_at: z.string().nullable(),
  note: z.string().nullable(),
});

export const SignalScoreSchema = z.object({
  signal: z.enum(["poi_density", "pedestrian_infrastructure", "review_velocity", "population_density"]),
  score: z.number().nullable(),
  status: z.enum(["available", "unavailable", "stale", "quota_limited", "not_applicable"]),
  weight: z.number(),
  note: z.string().nullable(),
});

export const CompetitorSaturationSchema = z.object({
  count_250m: z.number().int().nonnegative(),
  count_500m: z.number().int().nonnegative(),
  count_1000m: z.number().int().nonnegative(),
  label: z.enum(["low", "moderate", "high", "saturated"]),
});

export const RankedSiteBriefSchema = z.object({
  rank: z.number().int().positive(),
  location_label: z.string(),
  composite_site_score: z.number().nullable(),
  competitor_saturation_label: z.enum(["low", "moderate", "high", "saturated"]),
  key_strengths: z.array(z.string()),
  risk_factors: z.array(z.string()),
});

export const RecommendationBriefSchema = z.object({
  brief_status: z.literal("complete"),
  ranked_sites: z.array(RankedSiteBriefSchema),
  recommendation: z.string(),
  recommendation_rationale: z.string(),
  risk_factors: z.array(z.string()),
  suggested_action: z.string(),
  evidence_used: z.array(z.string()),
  limitations: z.array(z.string()),
});

export const SiteScoresSchema = z.object({
  location_label: z.string(),
  business_type: z.string().nullable(),
  radius_meters: z.number().int().positive(),
  poi_density_score: z.number().nullable(),
  pedestrian_infrastructure_score: z.number().nullable(),
  review_velocity_score: z.number().nullable(),
  population_density_score: z.number().nullable(),
  competitor_saturation: CompetitorSaturationSchema,
  inferred_peak_hours: z.array(z.string()),
  peak_hour_evidence: z.array(z.string()),
  composite_site_score: z.number().nullable(),
  weighted_signals_used: z.array(
    z.enum(["poi_density", "pedestrian_infrastructure", "review_velocity", "population_density"]),
  ),
  signal_scores: z.array(SignalScoreSchema),
  signal_availability: z.array(SourceAvailabilitySchema),
  scoring_notes: z.array(z.string()),
});

export const AreaSignalsSchema = z.object({
  location_label: z.string(),
  coordinates: CoordinatesSchema.nullable(),
  radius_meters: z.number().int().positive(),
  business_type: z.string().nullable(),
  poi_counts: z.record(z.string(), z.number()).nullable(),
  pedestrian_infrastructure: z
    .object({
      footway_length_meters: z.number().nonnegative(),
      crosswalk_count: z.number().int().nonnegative(),
      transit_stop_count: z.number().int().nonnegative(),
      building_footprint_count: z.number().int().nonnegative(),
    })
    .nullable(),
  review_activity: z.unknown().nullable(),
  population: z.unknown().nullable(),
  competitor_counts: z
    .object({
      within_250m: z.number().int().nonnegative(),
      within_500m: z.number().int().nonnegative(),
      within_1000m: z.number().int().nonnegative(),
    })
    .nullable(),
  amenity_mix: z.record(z.string(), z.number()).nullable(),
  transit: z.unknown().nullable(),
  pedestrian_accessibility: z.unknown().nullable(),
  availability: z.array(SourceAvailabilitySchema),
  source_notes: z.array(z.string()),
});

export const GetSiteIntelligenceInputSchema = z.object({
  location: LocationInputSchema,
  business_type: z.string().min(1),
  radius_meters: RadiusMetersSchema,
});

export const GetSiteIntelligenceOutputSchema = z.object({
  method: z.literal("get_site_intelligence"),
  site: SiteScoresSchema,
  evidence: AreaSignalsSchema,
  brief: RecommendationBriefSchema,
  latency_ms: z.number().nonnegative(),
});

export const CompareSitesInputSchema = z.object({
  locations: z.array(LocationInputSchema).min(2),
  business_type: z.string().min(1),
  radius_meters: RadiusMetersSchema,
});

export const RankedSiteSchema = z.object({
  rank: z.number().int().positive(),
  site: SiteScoresSchema,
  evidence: AreaSignalsSchema,
});

export const CompareSitesOutputSchema = z.object({
  method: z.literal("compare_sites"),
  ranked_sites: z.array(RankedSiteSchema),
  brief: RecommendationBriefSchema,
  latency_ms: z.number().nonnegative(),
});

export const GetAreaSignalsInputSchema = z.object({
  location: LocationInputSchema,
  radius_meters: RadiusMetersSchema,
});

export const GetAreaSignalsOutputSchema = z.object({
  method: z.literal("get_area_signals"),
  area: AreaSignalsSchema,
  latency_ms: z.number().nonnegative(),
});

export const GetCompetitorDensityInputSchema = z.object({
  location: LocationInputSchema,
  business_category: z.string().min(1),
});

export const GetCompetitorDensityOutputSchema = z.object({
  method: z.literal("get_competitor_density"),
  location_label: z.string(),
  coordinates: CoordinatesSchema.nullable(),
  business_category: z.string(),
  radius_bands_meters: z.tuple([z.literal(250), z.literal(500), z.literal(1000)]),
  competitor_saturation: CompetitorSaturationSchema,
  availability: z.array(SourceAvailabilitySchema),
  source_notes: z.array(z.string()),
  latency_ms: z.number().nonnegative(),
});

export const ToolErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type GetSiteIntelligenceInput = z.infer<typeof GetSiteIntelligenceInputSchema>;
export type CompareSitesInput = z.infer<typeof CompareSitesInputSchema>;
export type GetAreaSignalsInput = z.infer<typeof GetAreaSignalsInputSchema>;
export type GetCompetitorDensityInput = z.infer<typeof GetCompetitorDensityInputSchema>;
export type GetSiteIntelligenceOutput = z.infer<typeof GetSiteIntelligenceOutputSchema>;
export type CompareSitesOutput = z.infer<typeof CompareSitesOutputSchema>;
export type GetAreaSignalsOutput = z.infer<typeof GetAreaSignalsOutputSchema>;
export type GetCompetitorDensityOutput = z.infer<typeof GetCompetitorDensityOutputSchema>;
