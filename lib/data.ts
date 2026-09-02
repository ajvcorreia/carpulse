import { getDb } from "@/lib/db/client";
import { toCar, toPricePoint } from "@/lib/db/mappers";
import type { Car, CarWithPrices, PricePoint } from "@/lib/types";

type RawCarRow = Omit<Car, "is_removed" | "is_favorite" | "is_struck_out"> & {
  is_removed: number;
  is_favorite: number;
  is_struck_out: number;
};

// Same-day price entries tie on recorded_at alone — created_at (insertion
// order) breaks the tie deterministically. Carried over from the Postgres
// version's identical comment/fix.
function attachPriceHistory(rawCars: RawCarRow[]): CarWithPrices[] {
  if (rawCars.length === 0) return [];

  const db = getDb();
  const placeholders = rawCars.map(() => "?").join(", ");
  const prices = (
    db
      .prepare(
        `select * from price_history where car_id in (${placeholders}) order by recorded_at asc, created_at asc`
      )
      .all(...rawCars.map((c) => c.id)) as PricePoint[]
  ).map(toPricePoint);

  const byCarId = new Map<string, PricePoint[]>();
  for (const point of prices) {
    const list = byCarId.get(point.car_id);
    if (list) list.push(point);
    else byCarId.set(point.car_id, [point]);
  }

  return rawCars.map((row) => ({ ...toCar(row), price_history: byCarId.get(row.id) ?? [] }));
}

export async function getCarsWithPrices(): Promise<CarWithPrices[]> {
  const db = getDb();
  const rows = db.prepare("select * from cars order by created_at desc").all() as RawCarRow[];
  return attachPriceHistory(rows);
}

export async function getCarWithPrices(id: string): Promise<CarWithPrices | null> {
  const db = getDb();
  const row = db.prepare("select * from cars where id = ?").get(id) as RawCarRow | undefined;
  if (!row) return null;
  return attachPriceHistory([row])[0];
}

export async function getCarByUrl(url: string): Promise<CarWithPrices | null> {
  const db = getDb();
  const row = db.prepare("select * from cars where url = ?").get(url) as RawCarRow | undefined;
  if (!row) return null;
  return attachPriceHistory([row])[0];
}

// Suggestion lists for the make/model/spec autocomplete. Models are grouped
// by make (lowercased, for case-insensitive lookup as the user types) so the
// form can narrow model suggestions to the chosen make; makes/specs stay
// flat since nothing upstream of them to filter by.
export async function getCarFieldOptions(): Promise<{
  makes: string[];
  specs: string[];
  modelsByMake: Record<string, string[]>;
}> {
  const db = getDb();
  const rows = db.prepare("select make, model, spec from cars").all() as {
    make: string;
    model: string;
    spec: string | null;
  }[];

  const makes = Array.from(new Set(rows.map((c) => c.make))).sort();
  const specs = Array.from(new Set(rows.map((c) => c.spec).filter((v): v is string => !!v))).sort();

  const modelsByMake: Record<string, Set<string>> = {};
  for (const c of rows) {
    const key = c.make.toLowerCase();
    (modelsByMake[key] ??= new Set()).add(c.model);
  }

  return {
    makes,
    specs,
    modelsByMake: Object.fromEntries(
      Object.entries(modelsByMake).map(([key, set]) => [key, Array.from(set).sort()])
    ),
  };
}
