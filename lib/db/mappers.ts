import type { Car, PricePoint } from "@/lib/types";

// SQLite has no boolean type — is_removed/is_favorite/is_struck_out are
// stored as 0/1 integers. This is the one place that distinction gets
// translated back into real booleans; every column name otherwise matches
// the Car/PricePoint field names 1:1.
type CarRow = Omit<Car, "is_removed" | "is_favorite" | "is_struck_out"> & {
  is_removed: number;
  is_favorite: number;
  is_struck_out: number;
};

export function toCar(row: CarRow): Car {
  return {
    ...row,
    is_removed: Boolean(row.is_removed),
    is_favorite: Boolean(row.is_favorite),
    is_struck_out: Boolean(row.is_struck_out),
  };
}

// node:sqlite returns row objects with a null prototype (Object.create(null),
// not {}). That's invisible in plain JS, but React's Server->Client
// serialization boundary explicitly rejects it ("Only plain objects... Classes
// or null prototypes are not supported") — every row handed to a Client
// Component (as page props or a Server Action's return value) has to be
// re-spread into an actual plain object first, which is all this does.
export function toPricePoint(row: PricePoint): PricePoint {
  return { ...row };
}
