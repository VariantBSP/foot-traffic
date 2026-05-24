import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
// import { createContextMiddleware } from "@ctxprotocol/sdk";
import { SignalCache, loadDataSourceConfig } from "./data/index.js";
import { SiteSignalToolService } from "./mcp/service.js";
import {
  COMPARE_SITES_OUTPUT_SCHEMA,
  GET_AREA_SIGNALS_OUTPUT_SCHEMA,
  GET_COMPETITOR_DENSITY_OUTPUT_SCHEMA,
  GET_SITE_INTELLIGENCE_OUTPUT_SCHEMA,
} from "./mcp/output-schemas.js";
import type {
  GetSiteIntelligenceInput,
  CompareSitesInput,
  GetAreaSignalsInput,
  GetCompetitorDensityInput,
} from "./mcp/schemas.js";
import { createContextMiddleware } from "@ctxprotocol/sdk";

// ── Logger ─────────────────────────────────────────────────────────────────

const log = {
  info:  (msg: string, meta?: object) => console.log( `[INFO]  ${msg}`, meta ? JSON.stringify(meta) : ""),
  warn:  (msg: string, meta?: object) => console.warn( `[WARN]  ${msg}`, meta ? JSON.stringify(meta) : ""),
  error: (msg: string, meta?: object) => console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : ""),
};

// ── Shared service instance ────────────────────────────────────────────────
// One service → one SQLite connection → cache shared across all requests.

const service = new SiteSignalToolService();

// ── Tool definitions for tools/list ───────────────────────────────────────

const TOOLS = [
  {
    name:        "get_site_intelligence",
    description: "Return scored public foot-traffic proxy signals for one candidate site and business type.",
    inputSchema: {
      type: "object",
      properties: {
        location:      { oneOf: [{ type: "string", minLength: 1 }, { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } }, required: ["lat", "lon"] }] },
        business_type: { type: "string", minLength: 1 },
        radius_meters: { type: "integer", minimum: 100, maximum: 5000, default: 500 },
      },
      required: ["location", "business_type"],
    },
    outputSchema: GET_SITE_INTELLIGENCE_OUTPUT_SCHEMA,
  },
  {
    name:        "compare_sites",
    description: "Rank two or more candidate sites using public proxy signal scores.",
    inputSchema: {
      type: "object",
      properties: {
        locations:     { type: "array", items: { oneOf: [{ type: "string" }, { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } }, required: ["lat", "lon"] }] }, minItems: 2 },
        business_type: { type: "string", minLength: 1 },
        radius_meters: { type: "integer", minimum: 100, maximum: 5000, default: 500 },
      },
      required: ["locations", "business_type"],
    },
    outputSchema: COMPARE_SITES_OUTPUT_SCHEMA,
  },
  {
    name:        "get_area_signals",
    description: "Return normalized public proxy signals for a neighborhood or district before site selection.",
    inputSchema: {
      type: "object",
      properties: {
        location:      { oneOf: [{ type: "string", minLength: 1 }, { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } }, required: ["lat", "lon"] }] },
        radius_meters: { type: "integer", minimum: 100, maximum: 5000, default: 500 },
      },
      required: ["location"],
    },
    outputSchema: GET_AREA_SIGNALS_OUTPUT_SCHEMA,
  },
  {
    name:        "get_competitor_density",
    description: "Return similar venue counts across 250m, 500m, and 1km radius bands from OpenStreetMap.",
    inputSchema: {
      type: "object",
      properties: {
        location:          { oneOf: [{ type: "string", minLength: 1 }, { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } }, required: ["lat", "lon"] }] },
        business_category: { type: "string", minLength: 1 },
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

// CTX context middleware — verifies JWT for marketplace requests
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

  // Route SSE session messages
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

  if (method === "notifications/initialized") {
    res.status(204).end();
    return;
  }

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

// Graceful shutdown
process.on("SIGTERM", () => {
  log.info("shutdown");
  service.close();
  process.exit(0);
});