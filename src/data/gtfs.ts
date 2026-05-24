import { unzipSync } from "fflate";
import type { DataResult, GtfsFeedSignals, TransitSignals } from "../types/signals.js";

// ── GTFS feed directory ───────────────────────────────────────────────────
// Each entry has a bounding box so we pick the right feed from coordinates.
// URLs are official agency open-data feeds — no auth required.
// Cities not listed fall back to OSM amenity-based peak hour inference.

interface FeedEntry {
  city:    string;
  country: string;
  feedUrl: string;
  latMin:  number; latMax: number;
  lonMin:  number; lonMax: number;
}

const GTFS_FEEDS: FeedEntry[] = [
  // USA
  { city: "New York (Subway)", country: "US",
    feedUrl: "http://web.mta.info/developers/data/nyct/subway/google_transit.zip",
    latMin: 40.47, latMax: 40.92, lonMin: -74.27, lonMax: -73.70 },
  { city: "San Francisco",     country: "US",
    feedUrl: "https://gtfs.sfmta.com/transitdata/google_transit.zip",
    latMin: 37.63, latMax: 37.93, lonMin: -122.55, lonMax: -122.33 },
  { city: "Chicago",           country: "US",
    feedUrl: "https://www.transitchicago.com/downloads/sch_data/google_transit.zip",
    latMin: 41.60, latMax: 42.10, lonMin: -87.90, lonMax: -87.50 },
  { city: "Los Angeles",       country: "US",
    feedUrl: "https://gitlab.com/LACMTA/gtfs_rail/-/raw/master/gtfs_rail.zip",
    latMin: 33.70, latMax: 34.35, lonMin: -118.70, lonMax: -118.00 },
  // UK
  { city: "London",            country: "GB",
    feedUrl: "https://data.bus-data.dft.gov.uk/timetable/download/gtfs-file/london/",
    latMin: 51.25, latMax: 51.72, lonMin: -0.55, lonMax: 0.35 },
  // Canada
  { city: "Toronto",           country: "CA",
    feedUrl: "https://opendata.toronto.ca/toronto-transit-commission/ttc-routes-and-schedules/OpenData_TTC_Schedules.zip",
    latMin: 43.55, latMax: 43.86, lonMin: -79.65, lonMax: -79.10 },
  // Australia
  { city: "Sydney",            country: "AU",
    feedUrl: "https://api.transport.nsw.gov.au/v1/gtfs/schedule/buses/SydneyBuses_GTFS.zip",
    latMin: -34.18, latMax: -33.42, lonMin: 150.50, lonMax: 151.35 },
  // Netherlands
  { city: "Amsterdam",         country: "NL",
    feedUrl: "https://gtfs.ovapi.nl/nl/gtfs-nl.zip",
    latMin: 52.25, latMax: 52.50, lonMin: 4.70, lonMax: 5.10 },
  // Germany
  { city: "Berlin",            country: "DE",
    feedUrl: "https://www.vbb.de/fileadmin/user_upload/VBB/Dokumente/API-Datensaetze/gtfs-google_transit.zip",
    latMin: 52.33, latMax: 52.68, lonMin: 13.09, lonMax: 13.76 },
];

function feedsForCoordinates(lat: number, lon: number): FeedEntry[] {
  return GTFS_FEEDS.filter(
    f => lat >= f.latMin && lat <= f.latMax && lon >= f.lonMin && lon <= f.lonMax,
  );
}

// ── GTFS zip download and parse ───────────────────────────────────────────

interface StopRow { stopLat: number; stopLon: number }
interface StopTimeRow { arrivalHour: number }

async function downloadGtfs(feedUrl: string): Promise<Record<string, Uint8Array>> {
  const res = await fetch(feedUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GTFS feed HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  return unzipSync(new Uint8Array(buffer));
}

function parseCsvRows(content: string): { header: string[]; rows: string[][] } {
  const lines  = content.replace(/\r/g, "").split("\n").filter(l => l.trim().length > 0);
  const header = lines[0]?.split(",").map(h => h.trim().replace(/^"|"$/g, "")) ?? [];
  const rows   = lines.slice(1).map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
  return { header, rows };
}

function parseStops(files: Record<string, Uint8Array>, lat: number, lon: number, radiusKm: number): StopRow[] {
  const raw = files["stops.txt"];
  if (!raw) return [];
  const { header, rows } = parseCsvRows(new TextDecoder().decode(raw));
  const latIdx = header.indexOf("stop_lat");
  const lonIdx = header.indexOf("stop_lon");
  if (latIdx < 0 || lonIdx < 0) return [];

  const nearby: StopRow[] = [];
  for (const row of rows) {
    const sLat = parseFloat(row[latIdx] ?? "");
    const sLon = parseFloat(row[lonIdx] ?? "");
    if (isNaN(sLat) || isNaN(sLon)) continue;
    if (haversineKm(lat, lon, sLat, sLon) <= radiusKm) {
      nearby.push({ stopLat: sLat, stopLon: sLon });
    }
  }
  return nearby;
}

function parseStopTimes(files: Record<string, Uint8Array>, limit = 200_000): StopTimeRow[] {
  const raw = files["stop_times.txt"];
  if (!raw) return [];
  const text = new TextDecoder().decode(raw);
  const { header, rows } = parseCsvRows(text);
  const arrIdx = header.indexOf("arrival_time");
  if (arrIdx < 0) return [];

  const result: StopTimeRow[] = [];
  for (const row of rows.slice(0, limit)) {
    const time = row[arrIdx];
    if (!time) continue;
    const hour = parseInt(time.split(":")[0] ?? "99") % 24;
    if (!isNaN(hour)) result.push({ arrivalHour: hour });
  }
  return result;
}

function buildServiceEventsByHour(stopTimes: StopTimeRow[]): Record<string, number> {
  const byHour: Record<string, number> = {};
  for (const { arrivalHour } of stopTimes) {
    const k = String(arrivalHour).padStart(2, "0");
    byHour[k] = (byHour[k] ?? 0) + 1;
  }
  return byHour;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function fetchTransitSignals(
  lat:          number,
  lon:          number,
  radiusMeters: number,
): Promise<DataResult<TransitSignals>> {
  const source   = "gtfs" as const;
  const now      = new Date().toISOString();
  const radiusKm = radiusMeters / 1_000;
  const feeds    = feedsForCoordinates(lat, lon);

  if (feeds.length === 0) {
    return {
      data: null,
      availability: {
        source, status: "not_applicable", last_updated: now, expires_at: null,
        note: "No public GTFS feed available for this location — peak hours inferred from OSM amenity mix.",
      },
    };
  }

  const feedSignals: GtfsFeedSignals[] = [];
  let   totalStops = 0;
  const allHours: Record<string, number> = {};

  for (const feed of feeds.slice(0, 2)) {
    try {
      const files    = await downloadGtfs(feed.feedUrl);
      const stops    = parseStops(files, lat, lon, radiusKm);
      const times    = parseStopTimes(files);
      const byHour   = buildServiceEventsByHour(times);

      totalStops += stops.length;
      for (const [h, count] of Object.entries(byHour)) {
        allHours[h] = (allHours[h] ?? 0) + count;
      }

      feedSignals.push({
        feed_url:                  feed.feedUrl,
        stop_count:                stops.length,
        service_events_by_hour:    byHour,
      });
    } catch (err) {
      feedSignals.push({
        feed_url:               feed.feedUrl,
        stop_count:             0,
        service_events_by_hour: {},
      });
    }
  }

  return {
    data: {
      feed_count:             feedSignals.length,
      stop_count:             totalStops,
      service_events_by_hour: allHours,
      feeds:                  feedSignals,
    },
    availability: {
      source, status: "available", last_updated: now,
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString(),
      note: null,
    },
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R  = 6_371;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
