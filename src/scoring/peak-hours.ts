import type { NormalizedAreaSignals } from "../types/signals.js";
import type { PeakHourInference } from "../types/scoring.js";

const MORNING_AMENITIES = new Set(["cafe", "coffee_shop", "fitness_centre"]);
const MIDDAY_AMENITIES = new Set(["restaurant", "fast_food", "food_court"]);
const EVENING_AMENITIES = new Set(["bar", "pub", "nightclub", "restaurant", "cinema", "theatre"]);

export function inferPeakHours(signals: NormalizedAreaSignals): PeakHourInference {
  const evidence: string[] = [];
  const windows = new Set<string>();
  const amenityMix = signals.amenity_mix ?? {};

  const morningAmenityCount = countAmenities(amenityMix, MORNING_AMENITIES) + officeCount(amenityMix);
  const middayAmenityCount = countAmenities(amenityMix, MIDDAY_AMENITIES);
  const eveningAmenityCount = countAmenities(amenityMix, EVENING_AMENITIES);

  if (morningAmenityCount > 0) {
    windows.add("8am to 10am");
    evidence.push("Morning-oriented amenities or office context present.");
  }

  if (middayAmenityCount > 0) {
    windows.add("12pm to 2pm");
    evidence.push("Food-service amenity mix supports midday activity.");
  }

  if (eveningAmenityCount > 0) {
    windows.add("6pm to 9pm");
    evidence.push("Restaurant, bar, or entertainment mix supports evening activity.");
  }

  const transitPeaks = peakWindowsFromTransit(signals.transit?.service_events_by_hour ?? {});
  for (const transitPeak of transitPeaks.windows) {
    windows.add(transitPeak);
  }
  evidence.push(...transitPeaks.evidence);

  if (windows.size === 0) {
    windows.add("insufficient public signal for peak-hour inference");
    evidence.push("No amenity or GTFS signal strong enough for deterministic peak inference.");
  }

  return {
    windows: [...windows],
    evidence,
  };
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
  const midday = sumHours(eventsByHour, ["12", "13", "14"]);
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
