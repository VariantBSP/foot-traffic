import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createContextMiddleware } from "@ctxprotocol/sdk";
import { SignalCache, loadDataSourceConfig } from "./data/index.js";
import { SiteSignalToolService } from "./mcp/service.js";
import {
  COMPARE_SITES_OUTPUT_SCHEMA,
  GET_AREA_SIGNALS_OUTPUT_SCHEMA,
  GET_COMPETITOR_DENSITY_OUTPUT_SCHEMA,
  GET_SITE_INTELLIGENCE_OUTPUT_SCHEMA,
} from "./mcp/output-schemas.js";
import {
  type GetSiteIntelligenceInput,
  type CompareSitesInput,
  type GetAreaSignalsInput,
  type GetCompetitorDensityInput,
} from "./mcp/schemas.js";

// ── Logger ─────────────────────────────────────────────────────────────────

const log = {
  info:  (msg: string, meta?: object) => console.log( `[INFO]  ${msg}`, meta ? JSON.stringify(meta) : ""),
  warn:  (msg: string, meta?: object) => console.warn( `[WARN]  ${msg}`, meta ? JSON.stringify(meta) : ""),
  error: (msg: string, meta?: object) => console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : ""),
};

// ── Shared service instance ────────────────────────────────────────────────

const service = new SiteSignalToolService();

// ── Shared input schema fragments ──────────────────────────────────────────

const LOCATION_SCHEMA = {
  oneOf: [
    {
      type: "string",
      minLength: 1,
      description:
        'A place name, address, neighbourhood, or district string. Examples: "Lekki Phase 1, Lagos", "Westlands, Nairobi", "Osu, Accra, Ghana", "NYC Midtown". Use this for named locations.',
      examples: [
        "Lekki Phase 1, Lagos",
        "Yaba, Lagos, Nigeria",
        "Westlands, Nairobi",
        "Osu, Accra, Ghana",
        "Shoreditch, London",
        "NYC Midtown",
      ],
    },
    {
      type: "object",
      description:
        'Coordinates as an object with lat and lon number properties. Example: {"lat": 6.4317, "lon": 3.4823}. Both fields are required. Do NOT pass a bare number — a single number cannot identify a location.',
      properties: {
        lat: { type: "number", minimum: -90,  maximum: 90,  description: "Latitude"  },
        lon: { type: "number", minimum: -180, maximum: 180, description: "Longitude" },
      },
      required: ["lat", "lon"],
      additionalProperties: false,
      examples: [
        { lat: 6.4317, lon: 3.4823 },
        { lat: 51.5246, lon: -0.0765 },
        { lat: 40.7549, lon: -73.9840 },
      ],
    },
  ],
};

const RADIUS_SCHEMA = {
  type: "integer",
  minimum: 100,
  maximum: 5000,
  default: 500,
  description:
    "Search radius in metres. Default 500. Use 250–300 for walk-in retail. Use 1000–2000 for destination businesses.",
};

const BUSINESS_TYPE_SCHEMA = {
  type: "string",
  minLength: 1,
  description:
    'Business category used for competitor counting from OpenStreetMap. Examples: "restaurant", "cafe", "gym", "pharmacy", "supermarket", "bar", "bakery".',
  examples: ["restaurant", "cafe", "gym", "pharmacy", "supermarket", "bar", "bakery"],
};

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_site_intelligence",
    description: [
      "Full scored site intelligence brief for one candidate location and business type.",
      "Returns: composite site score (0-100) from POI density (25%), pedestrian infrastructure (25%),",
      "review velocity from Google Places (30%), and population density (20%).",
      "Also returns competitor saturation counts at 250m/500m/1km, inferred peak activity windows,",
      "walking isochrones for 5/10/15-minute catchment areas, and a plain-language recommendation brief.",
      "Replaces Placer.ai ($10,000–$27,000/year) for pre-lease site selection decisions.",
      "Cold: 2–15s. Warm cache: under 200ms.",
    ].join(" "),
    examples: [
      { input: { location: "Lekki Phase 1, Lagos", business_type: "restaurant", radius_meters: 500 } },
      { input: { location: { lat: 51.5246, lon: -0.0765 }, business_type: "cafe", radius_meters: 300 } },
    ],
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "slow",
      pricing: { executeUsd: "0.0010" },
      rateLimit: {
        maxRequestsPerMinute: 20,
        cooldownMs: 2000,
        maxConcurrency: 3,
        notes: "Cold fetches hit Overpass, Google Places, GeoNames, and OpenRouteService in parallel. 2–15s cold, under 200ms warm (24h TTL cache).",
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        location:      LOCATION_SCHEMA,
        business_type: BUSINESS_TYPE_SCHEMA,
        radius_meters: RADIUS_SCHEMA,
      },
      required: ["location", "business_type"],
    },
    outputSchema: GET_SITE_INTELLIGENCE_OUTPUT_SCHEMA,
  },

  {
    name: "compare_sites",
    description: [
      "Rank two or more candidate sites using public proxy signal scores.",
      "Returns scored profiles for each site in rank order, plus a comparison brief stating which site wins and why.",
      "All locations are fetched in parallel and cached independently — call once with all candidates",
      "rather than looping over get_site_intelligence.",
      "Cold: 4–20s depending on number of sites and location density. Warm cache: under 200ms.",
    ].join(" "),
    examples: [
      { input: { locations: ["Lekki Phase 1, Lagos", "Yaba, Lagos, Nigeria"], business_type: "restaurant", radius_meters: 500 } },
      { input: { locations: [{ lat: 6.4317, lon: 3.4823 }, { lat: 6.5095, lon: 3.3792 }], business_type: "cafe" } },
    ],
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "slow",
      pricing: { executeUsd: "0.0010" },
      rateLimit: {
        maxRequestsPerMinute: 10,
        cooldownMs: 3000,
        maxConcurrency: 2,
        notes: "Each location triggers a parallel data fetch. For more than 3 sites, expect 15–30s cold.",
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        locations: {
          type: "array",
          minItems: 2,
          description:
            'Two or more candidate sites. Each element is a place name string OR a {"lat": number, "lon": number} object. Never pass bare numbers. Minimum 2 locations.',
          items: LOCATION_SCHEMA,
          examples: [
            ["Lekki Phase 1, Lagos", "Yaba, Lagos, Nigeria"],
            ["Victoria Island, Lagos", "Yaba, Lagos, Nigeria", "Ikeja, Lagos"],
          ],
        },
        business_type: BUSINESS_TYPE_SCHEMA,
        radius_meters: RADIUS_SCHEMA,
      },
      required: ["locations", "business_type"],
    },
    outputSchema: COMPARE_SITES_OUTPUT_SCHEMA,
  },

  {
    name: "get_area_signals",
    description: [
      "Raw normalized public proxy signals for a neighbourhood or district — without scoring or recommendation prose.",
      "Returns: POI counts by category, footway length, crosswalk count, transit stop count, amenity mix,",
      "population, review activity, and source availability.",
      "Use this for lightweight neighbourhood research before committing to a specific business type.",
      "Faster than get_site_intelligence because it skips the scoring and recommendation layer.",
      "Cold: 2–10s. Warm cache: under 200ms.",
    ].join(" "),
    examples: [
      { input: { location: "Westlands, Nairobi", radius_meters: 500 } },
      { input: { location: { lat: 5.5560, lon: -0.1969 }, radius_meters: 1000 } },
    ],
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "slow",
      pricing: { executeUsd: "0.0005" },
      rateLimit: {
        maxRequestsPerMinute: 30,
        cooldownMs: 1000,
        maxConcurrency: 5,
        notes: "No scoring layer — faster than get_site_intelligence. Same cache TTLs.",
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        location:      LOCATION_SCHEMA,
        radius_meters: RADIUS_SCHEMA,
      },
      required: ["location"],
    },
    outputSchema: GET_AREA_SIGNALS_OUTPUT_SCHEMA,
  },

  {
    name: "get_competitor_density",
    description: [
      "Similar venue counts across 250m, 500m, and 1km radius bands from OpenStreetMap.",
      "Returns count_250m, count_500m, count_1000m, and a saturation label (low, moderate, high, saturated).",
      "Takes ONE location at a time. To compare saturation across two sites,",
      "call get_competitor_density once per location and compare the count_500m values.",
      "Cold: 1–5s. Warm cache: under 200ms.",
    ].join(" "),
    examples: [
      { input: { location: "Osu, Accra, Ghana", business_category: "restaurant" } },
      { input: { location: { lat: 6.4317, lon: 3.4823 }, business_category: "pharmacy" } },
    ],
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "fast",
      pricing: { executeUsd: "0.0005" },
      rateLimit: {
        maxRequestsPerMinute: 40,
        cooldownMs: 500,
        maxConcurrency: 8,
        notes: "Single Overpass query, 1000m radius only. Fastest tool in the set.",
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        location: {
          ...LOCATION_SCHEMA,
          description:
            'One location. Pass a place name string OR a {"lat": number, "lon": number} object. Do NOT pass a bare number. This tool takes ONE location at a time — call once per site.',
        },
        business_category: {
          type: "string",
          minLength: 1,
          description:
            'Business category to count competitors for. Examples: "restaurant", "cafe", "gym", "pharmacy", "bakery", "bar".',
          examples: ["restaurant", "cafe", "gym", "pharmacy", "bakery", "bar", "supermarket"],
        },
      },
      required: ["location", "business_category"],
    },
    outputSchema: GET_COMPETITOR_DENSITY_OUTPUT_SCHEMA,
  },
];

// ── Tool dispatch ──────────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (name) {
    case "get_site_intelligence":
      return service.getSiteIntelligence(args as unknown as GetSiteIntelligenceInput) as Promise<Record<string, unknown>>;
    case "compare_sites":
      return service.compareSites(args as unknown as CompareSitesInput) as Promise<Record<string, unknown>>;
    case "get_area_signals":
      return service.getAreaSignals(args as unknown as GetAreaSignalsInput) as Promise<Record<string, unknown>>;
    case "get_competitor_density":
      return service.getCompetitorDensity(args as unknown as GetCompetitorDensityInput) as Promise<Record<string, unknown>>;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP Server factory (for SSE sessions) ─────────────────────────────────

function makeServer(): Server {
  const server = new Server(
    { name: "open-foot-traffic-signal-engine", version: "0.1.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log.info("tools/list");
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const t0 = Date.now();
    log.info("tool/call", { name });

    try {
      const result = await handleTool(name, args as Record<string, unknown>);
      log.info("tool/ok", { name, ms: Date.now() - t0 });
      return {
        content:           [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("tool/err", { name, ms: Date.now() - t0, message });
      return {
        content:           [{ type: "text", text: `Error: ${message}` }],
        isError:           true,
        structuredContent: { error: message },
      };
    }
  });

  return server;
}

// ── Express app ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, _res, next) => {
  log.info("request", { method: req.method, path: req.path, rpc: req.body?.method });
  next();
});

app.use("/mcp", createContextMiddleware() as express.RequestHandler);

// ── SSE sessions ───────────────────────────────────────────────────────────

const sessions = new Map<string, SSEServerTransport>();

app.get("/mcp", async (_req: Request, res: Response) => {
  const transport = new SSEServerTransport("/mcp", res);
  const server    = makeServer();
  sessions.set(transport.sessionId, transport);

  res.on("close", () => {
    sessions.delete(transport.sessionId);
    log.info("sse/close", { activeSessions: sessions.size });
  });

  await server.connect(transport);
});

// ── Stateless POST handler ─────────────────────────────────────────────────

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.query["sessionId"] as string | undefined;

  if (sessionId) {
    const transport = sessions.get(sessionId);
    if (!transport) { res.status(404).json({ error: "Session not found" }); return; }
    await transport.handlePostMessage(req, res, req.body);
    return;
  }

  const { method, id } = req.body ?? {};

  if (method === "initialize") {
    res.json({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo:      { name: "open-foot-traffic-signal-engine", version: "0.1.0" },
        capabilities:    { tools: { listChanged: false } },
      },
    });
    return;
  }

  if (method === "notifications/initialized") { res.status(204).end(); return; }

  if (method === "notifications/cancelled") {
    log.warn("tool/cancelled", { id });
    res.json({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (method === "tools/list") {
    res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = req.body?.params ?? {};
    const t0 = Date.now();
    log.info("tool/call", { name });

    try {
      const result = await handleTool(name as string, args as Record<string, unknown>);
      log.info("tool/ok", { name, ms: Date.now() - t0 });
      res.json({
        jsonrpc: "2.0", id,
        result: {
          content:           [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("tool/err", { name, ms: Date.now() - t0, message });
      res.json({
        jsonrpc: "2.0", id,
        result: {
          content:           [{ type: "text", text: `Error: ${message}` }],
          isError:           true,
          structuredContent: { error: message },
        },
      });
    }
    return;
  }

  log.warn("unknown_method", { method });
  res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

// ── Health ─────────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  const config    = loadDataSourceConfig();
  const cache     = new SignalCache(config.cacheDbPath);
  const freshness = cache.getFreshness();
  cache.close();

  res.json({
    status:         "ok",
    service:        "open-foot-traffic-signal-engine",
    version:        "0.1.0",
    activeSessions: sessions.size,
    cache:          freshness,
  });
});

// ── Start ──────────────────────────────────────────────────────────────────

const port = Number.parseInt(process.env["PORT"] ?? "3000", 10);
app.listen(port, () => {
  log.info("listening", { port, env: process.env["NODE_ENV"] ?? "development" });
});

process.on("SIGTERM", () => {
  log.info("shutdown");
  service.close();
  process.exit(0);
});
