import type { NormalizedAreaSignals } from "../types/signals.js";
import type { PeakHourInference } from "../types/scoring.js";

const MORNING_AMENITIES = new Set(["cafe", "coffee_shop", "fitness_centre"]);
const MIDDAY_AMENITIES = new Set(["restaurant", "fast_food", "food_court"]);
const EVENING_AMENITIES = new Set(["bar", "pub", "nightclub", "restaurant", "cinema", "theatre"]);

export function inferPeakHours(signals: NormalizedAreaSignals): PeakHourInference {
  const evidence: string[] = [];
  const rawWindows = new Set<string>();
  const amenityMix = signals.amenity_mix ?? {};

  const morningAmenityCount = countAmenities(amenityMix, MORNING_AMENITIES) + officeCount(amenityMix);
  const middayAmenityCount = countAmenities(amenityMix, MIDDAY_AMENITIES);
  const eveningAmenityCount = countAmenities(amenityMix, EVENING_AMENITIES);

  if (morningAmenityCount > 0) {
    rawWindows.add("8am to 10am");
    evidence.push("Morning-oriented amenities or office context present.");
  }

  if (middayAmenityCount > 0) {
    rawWindows.add("12pm to 2pm");
    evidence.push("Food-service amenity mix supports midday activity.");
  }

  if (eveningAmenityCount > 0) {
    rawWindows.add("6pm to 9pm");
    evidence.push("Restaurant, bar, or entertainment mix supports evening activity.");
  }

  const transitPeaks = peakWindowsFromTransit(signals.transit?.service_events_by_hour ?? {});
  for (const transitPeak of transitPeaks.windows) {
    rawWindows.add(transitPeak);
  }
  evidence.push(...transitPeaks.evidence);

  // ── Merge overlapping windows ──────────────────────────────────────────
  // Amenity inference and GTFS inference can produce overlapping windows:
  // amenity: "8am to 10am" + GTFS: "7am to 10am" → both enter the Set as
  // different strings. Merge them into one canonical window ("7am to 10am").
  const mergedWindows = mergeOverlappingWindows([...rawWindows]);

  if (mergedWindows.length === 0) {
    return {
      windows: ["insufficient public signal for peak-hour inference"],
      evidence: [...evidence, "No amenity or GTFS signal strong enough for deterministic peak inference."],
    };
  }

  return {
    windows: mergedWindows,
    evidence,
  };
}

// ── Window merging ─────────────────────────────────────────────────────────

interface TimeRange {
  start: number; // 24h hour integer
  end:   number;
}

function parseWindow(window: string): TimeRange | null {
  const match = window.match(/^(\d+)(am|pm) to (\d+)(am|pm)$/);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4]) return null;
  return {
    start: toHour24(parseInt(match[1], 10), match[2] as "am" | "pm"),
    end:   toHour24(parseInt(match[3], 10), match[4] as "am" | "pm"),
  };
}

function toHour24(h: number, ampm: "am" | "pm"): number {
  if (ampm === "am") return h === 12 ? 0 : h;
  return h === 12 ? 12 : h + 12;
}

function formatHour24(h: number): string {
  if (h === 0)  return "12am";
  if (h < 12)   return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function mergeOverlappingWindows(windows: string[]): string[] {
  const parsed = windows.map(parseWindow).filter((w): w is TimeRange => w !== null);

  // Keep any strings that failed to parse (e.g. "insufficient..." fallbacks)
  const unparseable = windows.filter(w => parseWindow(w) === null);

  if (parsed.length === 0) return unparseable;

  // Sort by start hour, then merge adjacent/overlapping intervals
  parsed.sort((a, b) => a.start - b.start);

  const merged: TimeRange[] = [];
  for (const range of parsed) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return [
    ...merged.map(r => `${formatHour24(r.start)} to ${formatHour24(r.end)}`),
    ...unparseable,
  ];
}

function countAmenities(amenityMix: Record<string, number>, names: Set<string>): number {
  let total = 0;
  for (const [name, count] of Object.entries(amenityMix)) {
    if (names.has(name)) {
      total += count;
    }
  }

  return total;
}

function officeCount(amenityMix: Record<string, number>): number {
  let total = 0;
  for (const [name, count] of Object.entries(amenityMix)) {
    if (name.includes("office")) {
      total += count;
    }
  }

  return total;
}

function peakWindowsFromTransit(eventsByHour: Record<string, number>): PeakHourInference {
  const evidence: string[] = [];
  const windows = new Set<string>();
  const morning = sumHours(eventsByHour, ["07", "08", "09"]);
  const midday  = sumHours(eventsByHour, ["12", "13", "14"]);
  const evening = sumHours(eventsByHour, ["17", "18", "19", "20"]);

  if (morning > 0) {
    windows.add("7am to 10am");
    evidence.push("GTFS service events indicate morning transit activity.");
  }
  if (midday > 0) {
    windows.add("12pm to 3pm");
    evidence.push("GTFS service events indicate midday transit activity.");
  }
  if (evening > 0) {
    windows.add("5pm to 8pm");
    evidence.push("GTFS service events indicate evening transit activity.");
  }

  return {
    windows: [...windows],
    evidence,
  };
}

function sumHours(eventsByHour: Record<string, number>, hours: string[]): number {
  return hours.reduce((sum, hour) => sum + (eventsByHour[hour] ?? 0), 0);
}
