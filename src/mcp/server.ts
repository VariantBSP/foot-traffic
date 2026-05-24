import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeToolResult } from "./result.js";
import {
  CompareSitesInputSchema,
  CompareSitesOutputSchema,
  GetAreaSignalsInputSchema,
  GetAreaSignalsOutputSchema,
  GetCompetitorDensityInputSchema,
  GetCompetitorDensityOutputSchema,
  GetSiteIntelligenceInputSchema,
  GetSiteIntelligenceOutputSchema,
} from "./schemas.js";
import { SiteSignalToolService } from "./service.js";

export interface CreateSiteSignalMcpServerOptions {
  service?: SiteSignalToolService;
}

// ── CTX Protocol rate-limit metadata ─────────────────────────────────────
// _meta is a CTX Protocol extension field not in the MCP SDK ToolDefinition
// type. Each registration uses @ts-expect-error on the _meta line only so
// TypeScript still infers the input type for the callback correctly.

interface ToolMeta {
  surface:      "both" | "query" | "execute";
  latencyClass: "fast" | "slow" | "instant";
  rateLimit: {
    maxRequestsPerMinute: number;
    cooldownMs:           number;
    maxConcurrency:       number;
    notes:                string;
  };
}

const SLOW_META: ToolMeta = {
  surface:      "both",
  latencyClass: "slow",
  rateLimit: {
    maxRequestsPerMinute: 10,
    cooldownMs:           6_000,
    maxConcurrency:       2,
    notes:
      "Each call fires one combined Overpass query (single POST, no parallel requests) " +
      "plus parallel calls to Google Places, GeoNames, and OpenRouteService. " +
      "Nominatim geocoding is rate-limited client-side to 1 request per 1.1 seconds. " +
      "compare_sites runs locations in parallel but each fires its own Overpass query — " +
      "do not call with more than 3 locations at once on the public Overpass endpoint.",
  },
};

const FAST_META: ToolMeta = {
  surface:      "both",
  latencyClass: "fast",
  rateLimit: {
    maxRequestsPerMinute: 20,
    cooldownMs:           3_000,
    maxConcurrency:       4,
    notes:
      "Single Overpass competitor query only. No Google Places, GeoNames, or ORS calls. " +
      "Warm cache returns under 200ms.",
  },
};

export function createSiteSignalMcpServer(options: CreateSiteSignalMcpServerOptions = {}): McpServer {
  const service = options.service ?? new SiteSignalToolService();
  const server  = new McpServer({
    name:    "open-foot-traffic-signal-engine",
    version: "0.1.0",
  });

  server.registerTool(
    "get_site_intelligence",
    {
      title:        "Get Site Intelligence",
      description:  "Return scored public foot-traffic proxy signals for one candidate site and business type. " +
                    "Scores POI density, pedestrian infrastructure, review velocity, and population density. " +
                    "Returns competitor saturation, inferred peak hours, walkability isochrones, and a recommendation brief.",
      inputSchema:  GetSiteIntelligenceInputSchema,
      outputSchema: GetSiteIntelligenceOutputSchema,
      // @ts-expect-error _meta is a CTX Protocol extension not in the MCP SDK type
      _meta: SLOW_META,
    },
    async (input) => safeToolResult(() => service.getSiteIntelligence(input)),
  );

  server.registerTool(
    "compare_sites",
    {
      title:        "Compare Sites",
      description:  "Rank two or more candidate sites using public proxy signal scores. " +
                    "Returns all sites scored and ranked with a recommendation brief stating which site wins and why. " +
                    "Locations run in parallel. Use coordinates input to skip geocoding.",
      inputSchema:  CompareSitesInputSchema,
      outputSchema: CompareSitesOutputSchema,
      // @ts-expect-error _meta is a CTX Protocol extension not in the MCP SDK type
      _meta: SLOW_META,
    },
    async (input) => safeToolResult(() => service.compareSites(input)),
  );

  server.registerTool(
    "get_area_signals",
    {
      title:        "Get Area Signals",
      description:  "Return normalized public proxy signals for a neighborhood or district without scoring. " +
                    "Use before site selection to explore POI composition, pedestrian infrastructure, and amenity mix. " +
                    "Faster than get_site_intelligence — no scoring pipeline, no recommendation brief.",
      inputSchema:  GetAreaSignalsInputSchema,
      outputSchema: GetAreaSignalsOutputSchema,
      // @ts-expect-error _meta is a CTX Protocol extension not in the MCP SDK type
      _meta: SLOW_META,
    },
    async (input) => safeToolResult(() => service.getAreaSignals(input)),
  );

  server.registerTool(
    "get_competitor_density",
    {
      title:        "Get Competitor Density",
      description:  "Return similar venue counts across 250m, 500m, and 1km radius bands for a location and business category. " +
                    "Returns a saturation label (low, moderate, high, saturated) based on the 500m count. " +
                    "Does not contribute to the composite site score — use alongside get_site_intelligence.",
      inputSchema:  GetCompetitorDensityInputSchema,
      outputSchema: GetCompetitorDensityOutputSchema,
      // @ts-expect-error _meta is a CTX Protocol extension not in the MCP SDK type
      _meta: FAST_META,
    },
    async (input) => safeToolResult(() => service.getCompetitorDensity(input)),
  );

  return server;
}
