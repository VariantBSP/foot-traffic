import { Inflate } from "fflate";
import type { DataResult, GtfsFeedSignals, TransitSignals } from "../types/signals.js";

// ── GTFS feed directory ───────────────────────────────────────────────────

interface FeedEntry {
  city:    string;
  country: string;
  feedUrl: string;
  latMin:  number; latMax: number;
  lonMin:  number; lonMax: number;
}

const GTFS_FEEDS: FeedEntry[] = [
  { city: "New York (Subway)", country: "US",
    feedUrl: "http://web.mta.info/developers/data/nyct/subway/google_transit.zip",
    latMin: 40.47, latMax: 40.92, lonMin: -74.27, lonMax: -73.70 },
  { city: "San Francisco", country: "US",
    feedUrl: "https://gtfs.sfmta.com/transitdata/google_transit.zip",
    latMin: 37.63, latMax: 37.93, lonMin: -122.55, lonMax: -122.33 },
  { city: "Chicago", country: "US",
    feedUrl: "https://www.transitchicago.com/downloads/sch_data/google_transit.zip",
    latMin: 41.60, latMax: 42.10, lonMin: -87.90, lonMax: -87.50 },
  { city: "Los Angeles", country: "US",
    feedUrl: "https://gitlab.com/LACMTA/gtfs_rail/-/raw/master/gtfs_rail.zip",
    latMin: 33.70, latMax: 34.35, lonMin: -118.70, lonMax: -118.00 },
  // London excluded: DfT bus feed is 200MB+ compressed — exceeds size cap
  { city: "Toronto", country: "CA",
    feedUrl: "https://opendata.toronto.ca/toronto-transit-commission/ttc-routes-and-schedules/OpenData_TTC_Schedules.zip",
    latMin: 43.55, latMax: 43.86, lonMin: -79.65, lonMax: -79.10 },
  { city: "Amsterdam", country: "NL",
    feedUrl: "https://gtfs.ovapi.nl/nl/gtfs-nl.zip",
    latMin: 52.25, latMax: 52.50, lonMin: 4.70, lonMax: 5.10 },
  { city: "Berlin", country: "DE",
    feedUrl: "https://www.vbb.de/fileadmin/user_upload/VBB/Dokumente/API-Datensaetze/gtfs-google_transit.zip",
    latMin: 52.33, latMax: 52.68, lonMin: 13.09, lonMax: 13.76 },
];

const GTFS_MAX_BYTES = 60 * 1_024 * 1_024; // 60MB compressed cap

function feedsForCoordinates(lat: number, lon: number): FeedEntry[] {
  return GTFS_FEEDS.filter(
    f => lat >= f.latMin && lat <= f.latMax && lon >= f.lonMin && lon <= f.lonMax,
  );
}

// ── Module-level cache: only stores eventsByHour (tiny) ───────────────────
// Previous version cached allStops (16k+ objects) → caused 400MB persistent
// RSS. This version stores only the 24-entry service_events_by_hour map.

interface ParsedFeedData {
  eventsByHour: Record<string, number>;
  fetchedAt:    number;
}

const PARSED_FEED_CACHE = new Map<string, ParsedFeedData>();
const PARSED_FEED_TTL_MS = 12 * 60 * 60 * 1_000;

// In-flight deduplication: if two requests arrive for the same feedUrl while
// a download is already in progress, the second waits on the same Promise
// instead of starting a second download. Without this, two concurrent NYC
// requests would each download the 50MB ZIP simultaneously → 600MB+ peak → OOM.
const IN_FLIGHT = new Map<string, Promise<ParsedFeedData>>();

// ── ZIP central directory parser ─────────────────────────────────────────
// Reads the ZIP central directory (at the END of the file) to locate
// stop_times.txt's compressed data offset and size WITHOUT decompressing
// any other file. We then stream-decompress only that entry.

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! | b[o + 1]! << 8 | b[o + 2]! << 16 | b[o + 3]! << 24) >>> 0);
}
function u16(b: Uint8Array, o: number): number {
  return b[o]! | b[o + 1]! << 8;
}

interface ZipEntryInfo { dataOffset: number; compressedSize: number; method: number }

function findInZip(zip: Uint8Array, target: string): ZipEntryInfo | null {
  // Scan backwards for End of Central Directory signature (0x06054b50)
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_558); i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
      eocd = i; break;
    }
  }
  if (eocd < 0) return null;

  const cdOff   = u32(zip, eocd + 16);
  const cdCount = u16(zip, eocd + 10);
  const dec     = new TextDecoder();

  let pos = cdOff;
  for (let i = 0; i < cdCount; i++) {
    if (u32(zip, pos) !== 0x02014b50) break;            // Central Dir signature
    const method   = u16(zip, pos + 10);
    const cSize    = u32(zip, pos + 20);
    const fnLen    = u16(zip, pos + 28);
    const exLen    = u16(zip, pos + 30);
    const cmLen    = u16(zip, pos + 32);
    const lhOffset = u32(zip, pos + 42);
    const name     = dec.decode(zip.subarray(pos + 46, pos + 46 + fnLen));

    if (name === target) {
      // Local File Header extra field length may differ from central dir
      const lhExLen  = u16(zip, lhOffset + 28);
      const dataOff  = lhOffset + 30 + fnLen + lhExLen;
      return { dataOffset: dataOff, compressedSize: cSize, method };
    }
    pos += 46 + fnLen + exLen + cmLen;
  }
  return null;
}

// ── Streaming stop_times.txt decompressor ─────────────────────────────────
// Uses fflate's Inflate class to decompress chunk-by-chunk via ondata.
// Each chunk (~64KB) is processed immediately — the full 150-300MB
// decompressed content is NEVER held in memory at once.
// Peak memory: ZIP input buffer (50MB) + one chunk (64KB) + result (<1KB).
// Errors from push() are caught in the outer try/catch in downloadAndParseFeed.

function streamStopTimes(
  zip:   Uint8Array,
  entry: ZipEntryInfo,
  maxRows = 30_000,
): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    // subarray is a zero-copy view — no extra allocation for compressed bytes
    const compressed = zip.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);

    // Stored (uncompressed) entry — decode directly, skip inflate
    if (entry.method === 0) {
      resolve(parseStopTimesCsv(new TextDecoder().decode(compressed), maxRows));
      return;
    }

    const byHour: Record<string, number> = {};
    let leftover = "";
    let header:   string[] | null = null;
    let arrIdx    = -1;
    let rowCount  = 0;
    let done      = false;
    const dec     = new TextDecoder();
    const inf     = new Inflate();

    inf.ondata = (chunk: Uint8Array, final: boolean) => {
      if (done) return;

      const text  = leftover + dec.decode(chunk, { stream: !final });
      const lines = text.split("\n");
      leftover    = lines.pop() ?? "";

      for (const raw of lines) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (!line) continue;

        if (!header) {
          header = line.split(",").map(h => h.replace(/^"|"$/g, "").trim());
          arrIdx = header.indexOf("arrival_time");
          continue;
        }
        if (arrIdx < 0) break;

        const time = line.split(",")[arrIdx];
        if (time) {
          const hour = parseInt(time.split(":")[0] ?? "99") % 24;
          if (!isNaN(hour)) {
            const k = String(hour).padStart(2, "0");
            byHour[k] = (byHour[k] ?? 0) + 1;
          }
        }

        if (++rowCount >= maxRows) {
          done = true;
          resolve(byHour);
          return;
        }
      }

      if (final && !done) resolve(byHour);
    };

    // push() throws synchronously on corrupt deflate data
    try {
      inf.push(compressed, true);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function parseStopTimesCsv(csv: string, maxRows: number): Record<string, number> {
  const byHour: Record<string, number> = {};
  const lines  = csv.split("\n");
  const header = lines[0]?.split(",").map(h => h.replace(/^"|"$/g, "").trim()) ?? [];
  const arrIdx = header.indexOf("arrival_time");
  if (arrIdx < 0) return byHour;
  for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
    const time = lines[i]?.split(",")[arrIdx];
    if (time) {
      const hour = parseInt(time.split(":")[0] ?? "99") % 24;
      if (!isNaN(hour)) {
        const k = String(hour).padStart(2, "0");
        byHour[k] = (byHour[k] ?? 0) + 1;
      }
    }
  }
  return byHour;
}

// ── Download and parse one feed ───────────────────────────────────────────

async function downloadAndParseFeed(feedUrl: string): Promise<ParsedFeedData> {
  const cached = PARSED_FEED_CACHE.get(feedUrl);
  if (cached && Date.now() - cached.fetchedAt < PARSED_FEED_TTL_MS) return cached;

  // Deduplicate: return the in-flight promise if a download is already running
  const inflight = IN_FLIGHT.get(feedUrl);
  if (inflight) return inflight;

  const promise = (async (): Promise<ParsedFeedData> => {
    try {
      const res = await fetch(feedUrl, { signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`GTFS feed HTTP ${res.status}`);

      const cl = parseInt(res.headers.get("content-length") ?? "0", 10);
      if (cl > GTFS_MAX_BYTES) {
        throw new Error(`GTFS feed too large (${Math.round(cl / 1_024 / 1_024)}MB > 60MB cap)`);
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > GTFS_MAX_BYTES) {
        throw new Error(`GTFS feed too large (${Math.round(buffer.byteLength / 1_024 / 1_024)}MB > 60MB cap)`);
      }

      const zip   = new Uint8Array(buffer);
      const entry = findInZip(zip, "stop_times.txt");
      if (!entry) throw new Error("stop_times.txt not found in GTFS ZIP");

      const eventsByHour = await streamStopTimes(zip, entry);
      const parsed: ParsedFeedData = { eventsByHour, fetchedAt: Date.now() };
      PARSED_FEED_CACHE.set(feedUrl, parsed);
      return parsed;
    } finally {
      IN_FLIGHT.delete(feedUrl);
    }
  })();

  IN_FLIGHT.set(feedUrl, promise);
  return promise;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function fetchTransitSignals(
  lat:             number,
  lon:             number,
  _radiusMeters:   number,
): Promise<DataResult<TransitSignals>> {
  const source = "gtfs" as const;
  const now    = new Date().toISOString();
  const feeds  = feedsForCoordinates(lat, lon);

  if (feeds.length === 0) {
    return {
      data: null,
      availability: {
        source, status: "not_applicable", last_updated: now, expires_at: null,
        note: "No GTFS feed available for this location — peak hours inferred from OSM amenity mix.",
      },
    };
  }

  const feedSignals: GtfsFeedSignals[] = [];
  const allHours: Record<string, number> = {};

  for (const feed of feeds.slice(0, 2)) {
    try {
      const parsed = await downloadAndParseFeed(feed.feedUrl);
      for (const [h, count] of Object.entries(parsed.eventsByHour)) {
        allHours[h] = (allHours[h] ?? 0) + count;
      }
      feedSignals.push({
        feed_url:               feed.feedUrl,
        stop_count:             0,
        service_events_by_hour: parsed.eventsByHour,
      });
    } catch {
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
      stop_count:             0,
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