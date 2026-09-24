export type Car = {
  id: string;
  url: string;
  make: string;
  model: string;
  year: number;
  km: number | null;
  cylinders: number | null;
  spec: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  ad_placed_at: string | null;
  created_at: string;
  is_removed: boolean;
  is_favorite: boolean;
  is_struck_out: boolean;
  strike_out_reason: string | null;
  last_opened_at: string | null;
  // "Also listed at" grouping — points at the group's anchor car (see
  // lib/groups.ts). Null means either not grouped, or this car *is* the
  // anchor (other cars point at it instead).
  group_id: string | null;
};

export type PricePoint = {
  id: string;
  car_id: string;
  price: number;
  currency: string;
  recorded_at: string;
  created_at: string;
};

export type ListingHistoryEntry = {
  id: string;
  car_id: string;
  previous_url: string;
  previous_ad_placed_at: string | null;
  replaced_at: string;
};

export type CarWithPrices = Car & { price_history: PricePoint[]; listing_history: ListingHistoryEntry[] };
