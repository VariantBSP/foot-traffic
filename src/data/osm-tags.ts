// ── Business type → OSM tag mapping ──────────────────────────────────────
// Used by the Overpass query to count competitor venues of the same category.
// Returns a list of [key, value] pairs for the Overpass QL query builder.

export type OsmTagPair = [key: string, value: string];

const BUSINESS_TYPE_MAP: Record<string, OsmTagPair[]> = {
  // Food & Beverage
  restaurant:    [["amenity", "restaurant"], ["amenity", "fast_food"], ["amenity", "food_court"]],
  cafe:          [["amenity", "cafe"], ["amenity", "coffee_shop"]],
  "coffee shop": [["amenity", "cafe"], ["amenity", "coffee_shop"]],
  bar:           [["amenity", "bar"], ["amenity", "pub"], ["amenity", "biergarten"]],
  pub:           [["amenity", "pub"], ["amenity", "bar"]],
  "fast food":   [["amenity", "fast_food"]],
  bakery:        [["shop", "bakery"], ["amenity", "bakery"]],
  pizza:         [["amenity", "restaurant"], ["amenity", "fast_food"]],

  // Retail
  supermarket:   [["shop", "supermarket"], ["shop", "grocery"]],
  pharmacy:      [["amenity", "pharmacy"], ["shop", "chemist"]],
  clothing:      [["shop", "clothes"], ["shop", "fashion"]],
  electronics:   [["shop", "electronics"], ["shop", "computer"]],
  bookstore:     [["shop", "books"]],
  "hair salon":  [["shop", "hairdresser"]],
  salon:         [["shop", "hairdresser"], ["shop", "beauty"]],
  barber:        [["shop", "hairdresser"]],

  // Health & Fitness
  gym:           [["leisure", "fitness_centre"], ["leisure", "sports_centre"]],
  fitness:       [["leisure", "fitness_centre"]],
  yoga:          [["leisure", "fitness_centre"], ["leisure", "sports_centre"]],
  clinic:        [["amenity", "clinic"], ["amenity", "doctors"]],
  hospital:      [["amenity", "hospital"], ["amenity", "clinic"]],
  dentist:       [["amenity", "dentist"]],

  // Services
  bank:          [["amenity", "bank"]],
  atm:           [["amenity", "atm"]],
  hotel:         [["tourism", "hotel"], ["tourism", "motel"], ["tourism", "guest_house"]],
  laundry:       [["shop", "laundry"], ["amenity", "laundry"]],

  // Entertainment
  cinema:        [["amenity", "cinema"]],
  nightclub:     [["amenity", "nightclub"]],
};

// Normalise the input business type to a lookup key
function normalise(businessType: string): string {
  return businessType.toLowerCase().trim().replace(/s$/, ""); // crude singular
}

export function osmTagsForBusinessType(businessType: string): OsmTagPair[] {
  const key = normalise(businessType);
  for (const [pattern, tags] of Object.entries(BUSINESS_TYPE_MAP)) {
    if (key.includes(pattern) || pattern.includes(key)) {
      return tags;
    }
  }
  // Generic fallback — just match amenity=anything with the raw type as a tag
  return [["amenity", key], ["shop", key], ["leisure", key]];
}

// Mapping from OSM amenity values to human-readable category names
// Used for amenity_mix and POI type classification.
export const AMENITY_CATEGORIES: Record<string, string> = {
  restaurant:    "restaurant",
  fast_food:     "fast_food",
  cafe:          "cafe",
  bar:           "bar",
  pub:           "pub",
  nightclub:     "nightclub",
  food_court:    "fast_food",
  pharmacy:      "healthcare",
  clinic:        "healthcare",
  hospital:      "healthcare",
  doctors:       "healthcare",
  dentist:       "healthcare",
  bank:          "financial",
  atm:           "financial",
  school:        "education",
  college:       "education",
  university:    "education",
  library:       "education",
  place_of_worship: "civic",
  post_office:   "civic",
  police:        "civic",
  fire_station:  "civic",
  gym:           "fitness",
  fitness_centre: "fitness",
  sports_centre: "fitness",
  cinema:        "entertainment",
  theatre:       "entertainment",
  hotel:         "accommodation",
  guest_house:   "accommodation",
  hostel:        "accommodation",
  bus_station:   "transit",
  parking:       "parking",
  fuel:          "fuel",
  supermarket:   "retail",
  marketplace:   "retail",
  clothes:       "retail",
  hairdresser:   "services",
  beauty:        "services",
};
