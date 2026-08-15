export type Car = {
  id: string;
  url: string;
  make: string;
  model: string;
  year: number;
  km: number | null;
  spec: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  ad_placed_at: string | null;
  created_at: string;
  is_removed: boolean;
};

export type PricePoint = {
  id: string;
  car_id: string;
  price: number;
  currency: string;
  recorded_at: string;
  created_at: string;
};

export type CarWithPrices = Car & { price_history: PricePoint[] };
