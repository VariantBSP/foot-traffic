import type { DataResult, OverpassSignals, PedestrianInfrastructure, CompetitorCounts } from "../types/signals.js";
import { AMENITY_CATEGORIES, osmTagsForBusinessType } from "./osm-tags.js";

// ── Configurable endpoint ─────────────────────────────────────────────────

let overpassApiUrl = "https://overpass-api.de/api/interpreter";

export function configureOverpass(url: string | null | undefined): void {
  if (url) overpassApiUrl = url;
}

// ── Single combined query ─────────────────────────────────────────────────
// One POST to Overpass instead of 3–4 parallel ones.
// The public overpass-api.de instance enforces a "slot" fair-use policy that
// returns HTTP 406 when the same IP has concurrent requests in flight.
// Multiple output statements in one query body are valid Overpass QL —
// results concatenate into a single elements[] array.

function combinedQuery(lat: number, lon: number, radius: number, businessType: string | null): string {
  // Competitor filters: query ONLY the outermost radius (1000m), classify bands client-side.
  // This reduces 9 Overpass filter conditions (3 tags × 3 radii) to 3 — much faster server-side.
  const competitorFilters = businessType
    ? osmTagsForBusinessType(businessType)
        .map(([k, v]) => `  node["${k}"="${v}"](around:1000,${lat},${lon});`)
        .join("\n")
    : null;

  return `
[out:json][timeout:20][maxsize:2097152];
(
  node["amenity"](around:${radius},${lat},${lon});
  node["shop"](around:${radius},${lat},${lon});
  node["leisure"](around:${radius},${lat},${lon});
  node["tourism"](around:${radius},${lat},${lon});
  node["office"](around:${radius},${lat},${lon});
  node["highway"="crossing"](around:${radius},${lat},${lon});
  node["highway"="bus_stop"](around:${radius},${lat},${lon});
  node["public_transport"="stop_position"](around:${radius},${lat},${lon});
  node["railway"~"tram_stop|subway_entrance"](around:${radius},${lat},${lon});
);
out body qt 500;
(
  way["highway"~"footway|path|pedestrian|steps|living_street"](around:${radius},${lat},${lon});
);
out body qt 300;
${competitorFilters ? `(\n${competitorFilters}\n);\nout body qt 200;` : ""}
`.trim();
}

function competitorOnlyQuery(lat: number, lon: number, businessType: string): string {
  const filters = osmTagsForBusinessType(businessType)
    .map(([k, v]) => `  node["${k}"="${v}"](around:1000,${lat},${lon});`)
    .join("\n");
  return `[out:json][timeout:15];\n(\n${filters}\n);\nout body;`;
}

// ── HTTP fetch ────────────────────────────────────────────────────────────

async function overpassFetch(query: string): Promise<OsmElement[]> {
  const res = await fetch(overpassApiUrl, {
    method:  "POST",
    signal:  AbortSignal.timeout(25_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept":        "application/json",
      "User-Agent":    "SiteSignalMCP/1.0 (https://github.com/allwells/site-signal)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Overpass HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }
  const json = await res.json() as { elements?: OsmElement[] };
  return json.elements ?? [];
}

// ── OSM element types ─────────────────────────────────────────────────────

interface OsmNodeElement {
  type:  "node";
  id:    number;
  lat:   number;
  lon:   number;
  tags?: Record<string, string>;
}

interface OsmWayElement {
  type:      "way";
  id:        number;
  nodes?:    number[];
  geometry?: Array<{ lat: number; lon: number }>;
  tags?:     Record<string, string>;
}

type OsmElement = OsmNodeElement | OsmWayElement;

// ── Geometry ──────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180, Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Public: full area signals ─────────────────────────────────────────────

export async function fetchOverpassSignals(
  lat:          number,
  lon:          number,
  radiusMeters: number,
  businessType: string | null,
): Promise<DataResult<OverpassSignals>> {
  const source = "osm_overpass" as const;
  const now    = new Date().toISOString();

  try {
    const elements = await overpassFetch(combinedQuery(lat, lon, radiusMeters, businessType));

    const poiCounts:  Record<string, number> = {};
    const amenityMix: Record<string, number> = {};
    let footwayLengthMeters = 0, crosswalkCount = 0, transitStopCount = 0;
    const competitorCounts: CompetitorCounts = { within_250m: 0, within_500m: 0, within_1000m: 0 };

    for (const el of elements) {
      if (el.type === "way") {
        // Approximate footway length: each node pair ≈ 15m average segment length.
        // This avoids downloading geometry (which is the primary cold-latency bottleneck
        // in dense cities like London) while giving a usable proxy for footway density.
        if (el.nodes && el.nodes.length >= 2) {
          footwayLengthMeters += (el.nodes.length - 1) * 15;
        }
        continue;
      }

      if (el.type !== "node" || !el.tags) continue;
      const tags = el.tags;
      const hw   = tags["highway"] ?? "";
      const pt   = tags["public_transport"] ?? "";
      const ry   = tags["railway"] ?? "";

      // Pedestrian node
      if (hw === "crossing") { crosswalkCount++; continue; }
      if (hw === "bus_stop" || pt === "stop_position" || ry === "tram_stop" || ry === "subway_entrance") {
        transitStopCount++; continue;
      }

      // Competitor (when businessType is provided, competitor nodes are in the same elements[])
      if (businessType) {
        const bTags = osmTagsForBusinessType(businessType);
        const isComp = bTags.some(([k, v]) => tags[k] === v);
        if (isComp) {
          const dist = haversineMeters(lat, lon, el.lat, el.lon);
          if      (dist <= 250)  { competitorCounts.within_250m++; competitorCounts.within_500m++; competitorCounts.within_1000m++; }
          else if (dist <= 500)  { competitorCounts.within_500m++; competitorCounts.within_1000m++; }
          else if (dist <= 1000) { competitorCounts.within_1000m++; }
          continue;
        }
      }

      // POI
      const tag        = tags["amenity"] ?? tags["shop"] ?? tags["leisure"] ?? tags["tourism"] ?? tags["office"] ?? "other";
      poiCounts[tag]   = (poiCounts[tag]   ?? 0) + 1;
      const cat        = AMENITY_CATEGORIES[tag] ?? tag;
      amenityMix[cat]  = (amenityMix[cat]  ?? 0) + 1;
    }

    const pedestrianInfrastructure: PedestrianInfrastructure = {
      footway_length_meters:    Math.round(footwayLengthMeters),
      crosswalk_count:          crosswalkCount,
      transit_stop_count:       transitStopCount,
      building_footprint_count: 0,
    };

    return {
      data: {
        poi_counts:                poiCounts,
        amenity_mix:               amenityMix,
        pedestrian_infrastructure: pedestrianInfrastructure,
        competitor_counts:         competitorCounts,
        raw_element_count:         elements.length,
      },
      availability: {
        source, status: "available", last_updated: now,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        note: null,
      },
    };
  } catch (err) {
    return {
      data: null,
      availability: {
        source, status: "unavailable", last_updated: now, expires_at: null,
        note: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ── Public: competitor-only fetch ─────────────────────────────────────────

export async function fetchCompetitorCounts(
  lat:          number,
  lon:          number,
  businessType: string,
): Promise<DataResult<CompetitorCounts>> {
  const source = "osm_overpass" as const;
  const now    = new Date().toISOString();

  try {
    const elements = await overpassFetch(competitorOnlyQuery(lat, lon, businessType));
    const counts: CompetitorCounts = { within_250m: 0, within_500m: 0, within_1000m: 0 };

    for (const el of elements) {
      if (el.type !== "node") continue;
      const dist = haversineMeters(lat, lon, el.lat, el.lon);
      if      (dist <= 250)  { counts.within_250m++; counts.within_500m++; counts.within_1000m++; }
      else if (dist <= 500)  { counts.within_500m++; counts.within_1000m++; }
      else if (dist <= 1000) { counts.within_1000m++; }
    }
    return {
      data: counts,
      availability: {
        source, status: "available", last_updated: now,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        note: null,
      },
    };
  } catch (err) {
    return {
      data: null,
      availability: {
        source, status: "unavailable", last_updated: now, expires_at: null,
        note: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
