import type { DataResult, ReviewActivity, ReviewVenue } from "../types/signals.js";

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";

interface PlacesNearbyResult {
  place_id:           string;
  name:               string;
  rating:             number | null;
  user_ratings_total: number;
  types:              string[];
}

interface PlacesNearbyResponse {
  results: PlacesNearbyResult[];
  status:  string;
}

interface PlacesDetailsResponse {
  result?: {
    reviews?: Array<{
      time:         number; // Unix timestamp
      rating:       number;
      text:         string;
      author_name:  string;
    }>;
  };
  status: string;
}

// ── Nearby search ─────────────────────────────────────────────────────────

async function nearbySearch(
  lat: number,
  lon: number,
  radiusMeters: number,
  apiKey: string,
): Promise<PlacesNearbyResult[]> {
  const params = new URLSearchParams({
    location:  `${lat},${lon}`,
    radius:    String(Math.min(radiusMeters, 50_000)), // Places API max 50km
    key:       apiKey,
  });
  const res  = await fetch(`${PLACES_BASE}/nearbysearch/json?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Places nearby search HTTP ${res.status}`);
  const json = await res.json() as PlacesNearbyResponse;
  if (json.status === "REQUEST_DENIED" || json.status === "INVALID_REQUEST") {
    throw new Error(`Places API error: ${json.status}`);
  }
  return json.results ?? [];
}

// ── Place details — for recent review dates ───────────────────────────────
// We sample a small number of representative venues to get recent review dates.
// Fetching details for all venues would exhaust quota immediately.

async function placeDetails(
  placeId: string,
  apiKey:  string,
): Promise<PlacesDetailsResponse["result"]> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields:   "reviews",
    key:      apiKey,
  });
  const res  = await fetch(`${PLACES_BASE}/details/json?${params}`, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return undefined;
  const json = await res.json() as PlacesDetailsResponse;
  return json.result;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function fetchReviewActivity(
  lat:          number,
  lon:          number,
  radiusMeters: number,
  apiKey:       string | null,
): Promise<DataResult<ReviewActivity>> {
  const source = "google_places" as const;
  const now    = new Date().toISOString();

  if (!apiKey) {
    return {
      data: null,
      availability: { source, status: "unavailable", last_updated: now, expires_at: null, note: "GOOGLE_PLACES_API_KEY not set" },
    };
  }

  try {
    const venues = await nearbySearch(lat, lon, radiusMeters, apiKey);

    // Aggregate total reviews
    const totalReviews  = venues.reduce((sum, v) => sum + (v.user_ratings_total ?? 0), 0);
    const venueCount    = venues.length;
    const venuesWithReviews = venues.filter(v => (v.user_ratings_total ?? 0) > 0).length;

    // Sample top 3 venues by review count for recency data (quota-conscious)
    const topVenues = [...venues]
      .sort((a, b) => (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0))
      .slice(0, 3);

    // Fetch details for top 3 venues in parallel (not sequentially)
    const detailResults = await Promise.allSettled(
      topVenues.map(v => placeDetails(v.place_id, apiKey))
    );

    const ninetyDaysAgo     = Date.now() / 1_000 - 90 * 24 * 60 * 60;
    let   recentReviews90d  = 0;
    let   mostRecentAt: string | null = null;
    const representativeVenues: ReviewVenue[] = [];

    for (let i = 0; i < topVenues.length; i++) {
      const venue   = topVenues[i]!;
      const result  = detailResults[i];
      const details = result?.status === "fulfilled" ? result.value : undefined;
      const reviews = details?.reviews ?? [];

      recentReviews90d += reviews.filter(r => r.time >= ninetyDaysAgo).length;

      const latestReview = reviews.reduce<number | null>(
        (max, r) => (max === null || r.time > max ? r.time : max), null
      );
      if (latestReview !== null) {
        const iso = new Date(latestReview * 1_000).toISOString();
        if (mostRecentAt === null || iso > mostRecentAt) mostRecentAt = iso;
      }

      representativeVenues.push({
        id:                   venue.place_id,
        name:                 venue.name,
        rating:               venue.rating,
        review_count:         venue.user_ratings_total,
        types:                venue.types,
        most_recent_review_at: latestReview ? new Date(latestReview * 1_000).toISOString() : null,
      });
    }

    return {
      data: {
        total_reviews:          totalReviews,
        venue_count:            venueCount,
        venues_with_reviews:    venuesWithReviews,
        recent_reviews_90d:     recentReviews90d,
        review_recency_available: true,
        representative_venues:  representativeVenues,
      },
      availability: {
        source,
        status:       "available",
        last_updated: now,
        expires_at:   new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString(),
        note:         null,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isQuota = msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("over_query_limit");
    return {
      data: null,
      availability: {
        source,
        status:       isQuota ? "quota_limited" : "unavailable",
        last_updated: now,
        expires_at:   null,
        note:         msg,
      },
    };
  }
}
