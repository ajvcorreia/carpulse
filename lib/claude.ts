import type { Car } from "@/lib/types";

// claude.ai/new?q= opens a fresh conversation with the message box
// pre-filled — no API key or auth handoff needed, just a deep link.
export function claudeInsightsUrl(car: Car, latestPrice: string | null): string {
  const details = [`${car.year} ${car.make} ${car.model}`];
  if (car.spec) details.push(car.spec);
  if (car.cylinders != null) details.push(`${car.cylinders}-cylinder engine`);
  if (car.km != null) details.push(`${car.km.toLocaleString()} km on the odometer`);
  if (car.exterior_color) details.push(`${car.exterior_color} exterior`);
  if (car.interior_color) details.push(`${car.interior_color} interior`);
  if (latestPrice) details.push(`listed at ${latestPrice}`);

  const prompt =
    `I'm considering a used car: ${details.join(", ")}. ` +
    "Give me insights specific to this engine and trim: displacement, horsepower, torque, and the engine " +
    "model/code, known reliability, common recurring issues owners report, typical maintenance costs, and " +
    "major maintenance items to budget for at this mileage (timing belt/chain, transmission service, etc.).";

  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
