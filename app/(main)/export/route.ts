import { NextResponse } from "next/server";
import { getCarsWithPrices } from "@/lib/data";

export async function GET() {
  const cars = await getCarsWithPrices();

  const payload = {
    exported_at: new Date().toISOString(),
    cars: cars.map((c) => ({
      url: c.url,
      make: c.make,
      model: c.model,
      year: c.year,
      km: c.km,
      cylinders: c.cylinders,
      spec: c.spec,
      exterior_color: c.exterior_color,
      interior_color: c.interior_color,
      ad_placed_at: c.ad_placed_at,
      created_at: c.created_at,
      is_favorite: c.is_favorite,
      is_removed: c.is_removed,
      is_struck_out: c.is_struck_out,
      strike_out_reason: c.strike_out_reason,
      price_history: c.price_history.map((p) => ({
        price: p.price,
        currency: p.currency,
        recorded_at: p.recorded_at,
      })),
    })),
  };

  const filename = `carpulse-export-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
