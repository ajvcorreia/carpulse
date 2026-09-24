import type { Car } from "@/lib/types";

// A car's group identity: its own group_id if set, otherwise its own id
// (meaning it's either ungrouped or is itself the anchor other cars point
// at). Two cars are "also listed" siblings exactly when this resolves to
// the same value for both.
export function groupAnchorId(car: Pick<Car, "id" | "group_id">): string {
  return car.group_id ?? car.id;
}

// Every other car sharing car's group, from an already-fetched list — no
// extra query needed since the dashboard already loads every tracked car.
export function groupMembers<T extends Pick<Car, "id" | "group_id">>(cars: T[], car: T): T[] {
  const anchor = groupAnchorId(car);
  return cars.filter((c) => c.id !== car.id && groupAnchorId(c) === anchor);
}
