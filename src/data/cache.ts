// ── SQLite cache using Node.js built-in sqlite module ────────────────────
// Node.js 22+ ships node:sqlite with a synchronous API identical to
// better-sqlite3. No native compilation required — zero external deps.
// If you are on Node < 22, install better-sqlite3 and swap the import.

import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as path from "path";

// ── TTLs per source (ms) ──────────────────────────────────────────────────
const TTL: Record<string, number> = {
  nominatim:         7  * 24 * 60 * 60 * 1_000,
  osm_overpass:      7  * 24 * 60 * 60 * 1_000,
  google_places:     48 *      60 * 60 * 1_000,
  geonames:          30 * 24 * 60 * 60 * 1_000,
  gtfs:              14 * 24 * 60 * 60 * 1_000,
  openrouteservice:  7  * 24 * 60 * 60 * 1_000,
  normalized_area:   24 *      60 * 60 * 1_000,
};

export interface CachedEntry<T = unknown> {
  value:     T;
  cachedAt:  number;
  expiresAt: number;
  source:    string;
  cacheKey:  string;
}

export interface CacheFreshness {
  total_entries: number;
  fresh_entries: number;
  stale_entries: number;
}

export class SignalCache {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signal_cache (
        cache_key   TEXT    NOT NULL,
        source      TEXT    NOT NULL,
        value       TEXT    NOT NULL,
        cached_at   INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        PRIMARY KEY (cache_key, source)
      );
      CREATE INDEX IF NOT EXISTS idx_expires ON signal_cache (expires_at);
    `);
  }

  get<T>(cacheKey: string, source: string): CachedEntry<T> | null {
    const row = this.db
      .prepare(
        "SELECT value, cached_at, expires_at FROM signal_cache WHERE cache_key = ? AND source = ? AND expires_at > ?",
      )
      .get(cacheKey, source, Date.now()) as { value: string; cached_at: number; expires_at: number } | undefined;

    if (!row) return null;
    return {
      value:     JSON.parse(row.value) as T,
      cachedAt:  row.cached_at,
      expiresAt: row.expires_at,
      source,
      cacheKey,
    };
  }

  set<T>(cacheKey: string, source: string, value: T): void {
    const now       = Date.now();
    const ttl       = TTL[source] ?? 24 * 60 * 60 * 1_000;
    const expiresAt = now + ttl;
    this.db
      .prepare(`
        INSERT INTO signal_cache (cache_key, source, value, cached_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (cache_key, source) DO UPDATE SET
          value      = excluded.value,
          cached_at  = excluded.cached_at,
          expires_at = excluded.expires_at
      `)
      .run(cacheKey, source, JSON.stringify(value), now, expiresAt);
  }

  evictExpired(): number {
    const result = this.db
      .prepare("DELETE FROM signal_cache WHERE expires_at <= ?")
      .run(Date.now()) as { changes: number };
    return result.changes;
  }

  getFreshness(): CacheFreshness {
    const now   = Date.now();
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM signal_cache").get() as { n: number }).n;
    const fresh = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM signal_cache WHERE expires_at > ?")
        .get(now) as { n: number }
    ).n;
    return { total_entries: total, fresh_entries: fresh, stale_entries: total - fresh };
  }

  close(): void {
    this.db.close();
  }
}

// ── Cache key helpers ─────────────────────────────────────────────────────

export function locationCacheKey(lat: number, lon: number, radiusMeters: number, suffix = ""): string {
  const latR = Math.round(lat * 10_000) / 10_000;
  const lonR = Math.round(lon * 10_000) / 10_000;
  return `${latR},${lonR},r${radiusMeters}${suffix ? `,${suffix}` : ""}`;
}

export function geocodeCacheKey(query: string): string {
  return `geocode:${query.toLowerCase().trim()}`;
}
