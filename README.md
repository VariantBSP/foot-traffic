# SiteSignal MCP

**Site selection intelligence for AI agents.**
POI density, pedestrian infrastructure, review velocity, competitor saturation — scored and ranked into a structured site brief on the [Context marketplace](https://ctxprotocol.com).

## What it is

| Signal | Source | Method |
|---|---|---|
| POI density score | OpenStreetMap via Overpass API | Live node count, 500m radius |
| Pedestrian infrastructure score | OpenStreetMap footways + crossings | Footway length + crossings + transit stops |
| Review velocity score | Google Places API (official free tier) | Recent review count + recency weighting |
| Population density score | GeoNames open database | findNearbyPlaceName query |
| Competitor saturation | OpenStreetMap via Overpass API | Similar venue counts at 250m / 500m / 1km |
| Walking catchment area | OpenRouteService isochrones | 5 / 10 / 15-minute walkability polygons |
| Peak hour inference | OSM amenity mix + GTFS feeds | Deterministic classifier on venue composition |

No mobile device data. No scraping. No proprietary location datasets.

## Tools

| Tool | Description | Latency |
|---|---|---|
| `get_site_intelligence` | Full scored brief for one location: composite score, all signals, competitor saturation, peak hours, recommendation | ~2–15s cold / sub-200ms cached |
| `compare_sites` | Ranked comparison of two or more candidates with a winner recommendation | ~4–20s cold / sub-200ms cached |
| `get_area_signals` | Raw normalized signals without scoring, for pre-decision neighborhood research | ~2–10s cold / sub-200ms cached |
| `get_competitor_density` | Similar venue counts across 250m, 500m, 1km radius bands with saturation label | ~1–5s cold / sub-200ms cached |

All four tools share a 24-hour SQLite cache — the first call for a location pays the cold penalty; subsequent calls are instant.

## Run locally

```bash
npm install
npm run dev
```

Test with curl:

```bash
# List tools
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Site brief for Osu, Accra
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "id": 2,
    "params": {
      "name": "get_site_intelligence",
      "arguments": {
        "location": "Osu, Accra, Ghana",
        "business_type": "restaurant",
        "radius_meters": 500
      }
    }
  }' | jq '{
    score: .result.structuredContent.site.composite_site_score,
    signals: .result.structuredContent.site.weighted_signals_used,
    recommendation: .result.structuredContent.brief.recommendation
  }'

# Compare Lekki vs Yaba
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "id": 3,
    "params": {
      "name": "compare_sites",
      "arguments": {
        "locations": [
          "Lekki Phase 1, Lagos",
          "Yaba, Lagos, Nigeria"
        ],
        "business_type": "restaurant",
        "radius_meters": 500
      }
    }
  }' | jq '{
    winner: .result.structuredContent.ranked_sites[0].site.location_label,
    winner_score: .result.structuredContent.ranked_sites[0].site.composite_site_score,
    runner_up: .result.structuredContent.ranked_sites[1].site.location_label,
    runner_up_score: .result.structuredContent.ranked_sites[1].site.composite_site_score
  }'

# Competitor density only
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "id": 4,
    "params": {
      "name": "get_competitor_density",
      "arguments": {
        "location": "Osu, Accra, Ghana",
        "business_category": "restaurant"
      }
    }
  }' | jq '{
    saturation: .result.structuredContent.competitor_saturation.label,
    within_500m: .result.structuredContent.competitor_saturation.count_500m
  }'
```

> Note: `tools/call` returns `{"error":"Unauthorized"}` locally unless you have a valid CTX JWT. This is expected — the CTX middleware guards paid calls. Comment out `createContextMiddleware()` in `server.ts` for local development.

## Transport

The server uses `StreamableHTTPServerTransport` with a stateless POST handler:

- `POST /mcp` — stateless single-shot handler for CTX discovery and paid calls
- `GET /health` — returns server status and cache freshness

## Scoring model

```txt
composite_site_score = weighted average of available signals

POI density                 25%
Pedestrian infrastructure   25%
Review velocity             30%
Population density          20%
```

Signal normalization:

```txt
POI density:
  OSM amenity + commerce node count
  benchmarked against 120-POI urban baseline

Pedestrian infrastructure:
  footway length
  + crossings
  + transit stops

Review velocity:
  Google Places total reviews
  + recency weighting

Population density:
  GeoNames nearby population
  benchmarked against 1M population baseline
```

Competitor saturation is displayed separately and never affects `composite_site_score`.

If a signal source is unavailable, the composite score recalculates from remaining weighted signals only.

## Peak hour classifier

```txt
OSM amenity composition:

cafe / fitness_centre / office
  → morning peak (8am–10am)

restaurant / fast_food
  → midday peak (12pm–2pm)

bar / pub / nightclub
  → evening peak (6pm–9pm)
```

GTFS transit feeds supplement inference where available:

- New York
- San Francisco
- Chicago
- Los Angeles
- London
- Toronto
- Sydney
- Amsterdam
- Berlin

All other cities fall back to OSM amenity inference.

## Tested latency

| Location | Score | Cold latency |
|---|---|---|
| Osu, Accra, Ghana | 66/100 | 2.1s |
| Nairobi Westlands | 9/100 | 2.5s |
| NYC Midtown | 72/100 | 4.3s |
| Yaba, Lagos | 3/100 | ~5s |
| Shoreditch, London | 91/100 | 30s* |

\* Shoreditch is a documented extreme-density outlier.

All target markets (Lagos, Nairobi, Accra) return under 5s cold.

Low scores in some African cities may partially reflect OpenStreetMap coverage density rather than real-world commercial weakness. Mapping completeness varies significantly by region.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default: 3000) | Server port |
| `CACHE_DB_PATH` | No (default: ./data/cache.sqlite) | SQLite cache file path |
| `GOOGLE_PLACES_API_KEY` | Yes for review velocity | Enable Places API in Google Cloud |
| `GEONAMES_USERNAME` | Yes for population density | Free GeoNames account with web services enabled |
| `OPENROUTESERVICE_API_KEY` | Yes for walkability isochrones | Free OpenRouteService account |
| `NOMINATIM_USER_AGENT` | Yes | Required by Nominatim ToS: `AppName/1.0 (email@example.com)` |
| `NOMINATIM_BASE_URL` | No | Custom Nominatim instance |
| `OVERPASS_API_URL` | No | Custom Overpass mirror |

Without Google Places, GeoNames, or OpenRouteService credentials, the tool still returns available OSM-derived signals and recalculates the composite score from remaining inputs.

## Architecture

```txt
POST tools/call
      ↓
site-intelligence.ts
      ↓ parallel Promise.all
 ┌──────────┬────────────┬────────────┬────────────┬────────────┐
 ↓          ↓            ↓            ↓            ↓
nominatim  overpass     places       geonames     ors
geocoder   signals      reviews      population   isochrones
 └──────────┴────────────┴────────────┴────────────┴────────────┘
      ↓
signal normalization
      ↓
weighted composite scoring
      ↓
site brief generation
      ↓
SQLite cache (24h)
      ↓
return structured MCP response
```