// Explicit JSON Schema objects for each tool output.
// Passed directly to registerTool() as outputSchema to avoid
// the MCP SDK's Zod-to-JSON-Schema conversion, which silently
// drops outputSchema when the Zod version is incompatible.
// Root type must be "object" — CTX will reject any other root type.

export const GET_SITE_INTELLIGENCE_OUTPUT_SCHEMA = {
  type: "object",
  required: ["method", "site", "evidence", "brief", "latency_ms"],
  properties: {
    method:      { type: "string", enum: ["get_site_intelligence"] },
    latency_ms:  { type: "number" },
    site: {
      type: "object",
      required: ["location_label", "composite_site_score", "weighted_signals_used", "signal_scores", "signal_availability", "competitor_saturation", "inferred_peak_hours"],
      properties: {
        location_label:                  { type: "string" },
        business_type:                   { type: ["string", "null"] },
        radius_meters:                   { type: "number" },
        composite_site_score:            { type: ["number", "null"] },
        poi_density_score:               { type: ["number", "null"] },
        pedestrian_infrastructure_score: { type: ["number", "null"] },
        review_velocity_score:           { type: ["number", "null"] },
        population_density_score:        { type: ["number", "null"] },
        weighted_signals_used:           { type: "array", items: { type: "string" } },
        inferred_peak_hours:             { type: "array", items: { type: "string" } },
        peak_hour_evidence:              { type: "array", items: { type: "string" } },
        scoring_notes:                   { type: "array", items: { type: "string" } },
        competitor_saturation: {
          type: "object",
          required: ["count_250m", "count_500m", "count_1000m", "label"],
          properties: {
            count_250m: { type: "number" },
            count_500m: { type: "number" },
            count_1000m: { type: "number" },
            label: { type: "string", enum: ["low", "moderate", "high", "saturated"] },
          },
        },
        signal_scores: {
          type: "array",
          items: {
            type: "object",
            required: ["signal", "score", "status", "weight", "note"],
            properties: {
              signal: { type: "string" },
              score:  { type: ["number", "null"] },
              status: { type: "string" },
              weight: { type: "number" },
              note:   { type: ["string", "null"] },
            },
          },
        },
        signal_availability: {
          type: "array",
          items: {
            type: "object",
            required: ["source", "status", "last_updated", "expires_at", "note"],
            properties: {
              source:       { type: "string" },
              status:       { type: "string" },
              last_updated: { type: ["string", "null"] },
              expires_at:   { type: ["string", "null"] },
              note:         { type: ["string", "null"] },
            },
          },
        },
      },
    },
    evidence: {
      type: "object",
      required: ["location_label", "radius_meters", "availability", "source_notes"],
      properties: {
        location_label: { type: "string" },
        coordinates: {
          type: ["object", "null"],
          properties: { lat: { type: "number" }, lon: { type: "number" } },
        },
        radius_meters:             { type: "number" },
        business_type:             { type: ["string", "null"] },
        poi_counts:                { type: ["object", "null"] },
        amenity_mix:               { type: ["object", "null"] },
        pedestrian_infrastructure: { type: ["object", "null"] },
        review_activity:           { type: ["object", "null"] },
        population:                { type: ["object", "null"] },
        competitor_counts:         { type: ["object", "null"] },
        transit:                   { type: ["object", "null"] },
        pedestrian_accessibility:  { type: ["object", "null"] },
        source_notes: { type: "array", items: { type: "string" } },
        availability: { type: "array", items: { type: "object" } },
      },
    },
    brief: {
      type: "object",
      required: ["brief_status", "ranked_sites", "recommendation", "recommendation_rationale", "risk_factors", "suggested_action", "evidence_used", "limitations"],
      properties: {
        brief_status:             { type: "string" },
        recommendation:           { type: "string" },
        recommendation_rationale: { type: "string" },
        suggested_action:         { type: "string" },
        risk_factors:             { type: "array", items: { type: "string" } },
        evidence_used:            { type: "array", items: { type: "string" } },
        limitations:              { type: "array", items: { type: "string" } },
        ranked_sites: {
          type: "array",
          items: {
            type: "object",
            required: ["rank", "location_label", "composite_site_score", "competitor_saturation_label", "key_strengths", "risk_factors"],
            properties: {
              rank:                        { type: "number" },
              location_label:              { type: "string" },
              composite_site_score:        { type: ["number", "null"] },
              competitor_saturation_label: { type: "string" },
              key_strengths:               { type: "array", items: { type: "string" } },
              risk_factors:                { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

export const COMPARE_SITES_OUTPUT_SCHEMA = {
  type: "object",
  required: ["method", "ranked_sites", "brief", "latency_ms"],
  properties: {
    method:      { type: "string", enum: ["compare_sites"] },
    latency_ms:  { type: "number" },
    ranked_sites: {
      type: "array",
      items: {
        type: "object",
        required: ["rank", "site", "evidence"],
        properties: {
          rank:     { type: "number" },
          site:     { type: "object" },
          evidence: { type: "object" },
        },
      },
    },
    brief: { type: "object" },
  },
} as const;

export const GET_AREA_SIGNALS_OUTPUT_SCHEMA = {
  type: "object",
  required: ["method", "area", "latency_ms"],
  properties: {
    method:     { type: "string", enum: ["get_area_signals"] },
    latency_ms: { type: "number" },
    area: {
      type: "object",
      required: ["location_label", "radius_meters", "availability", "source_notes"],
      properties: {
        location_label: { type: "string" },
        coordinates: {
          type: ["object", "null"],
          properties: { lat: { type: "number" }, lon: { type: "number" } },
        },
        radius_meters:             { type: "number" },
        business_type:             { type: ["string", "null"] },
        poi_counts:                { type: ["object", "null"] },
        amenity_mix:               { type: ["object", "null"] },
        pedestrian_infrastructure: { type: ["object", "null"] },
        review_activity:           { type: ["object", "null"] },
        population:                { type: ["object", "null"] },
        competitor_counts:         { type: ["object", "null"] },
        transit:                   { type: ["object", "null"] },
        pedestrian_accessibility:  { type: ["object", "null"] },
        source_notes: { type: "array", items: { type: "string" } },
        availability: { type: "array", items: { type: "object" } },
      },
    },
  },
} as const;

export const GET_COMPETITOR_DENSITY_OUTPUT_SCHEMA = {
  type: "object",
  required: ["method", "location_label", "coordinates", "business_category", "radius_bands_meters", "competitor_saturation", "availability", "source_notes", "latency_ms"],
  properties: {
    method:            { type: "string", enum: ["get_competitor_density"] },
    location_label:    { type: "string" },
    business_category: { type: "string" },
    latency_ms:        { type: "number" },
    coordinates: {
      type: ["object", "null"],
      properties: { lat: { type: "number" }, lon: { type: "number" } },
    },
    radius_bands_meters: {
      type: "array",
      items: { type: "number" },
    },
    competitor_saturation: {
      type: "object",
      required: ["count_250m", "count_500m", "count_1000m", "label"],
      properties: {
        count_250m:  { type: "number" },
        count_500m:  { type: "number" },
        count_1000m: { type: "number" },
        label:       { type: "string", enum: ["low", "moderate", "high", "saturated"] },
      },
    },
    availability: { type: "array", items: { type: "object" } },
    source_notes: { type: "array", items: { type: "string" } },
  },
} as const;