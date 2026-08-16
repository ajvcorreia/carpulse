import Link from "next/link";
import { notFound } from "next/navigation";
import { getCarWithPrices } from "@/lib/data";
import { PriceChart } from "@/components/PriceChart";
import { AddPriceForm } from "@/components/AddPriceForm";
import { PriceHistoryList } from "@/components/PriceHistoryList";
import { FavoriteToggle } from "@/components/FavoriteToggle";
import { setCarRemoved } from "@/lib/actions";
import { formatPrice, latestDelta } from "@/lib/format";

export default async function CarDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const car = await getCarWithPrices(id);

  if (!car) {
    notFound();
  }

  const latest = car.price_history[car.price_history.length - 1];
  const delta = latestDelta(car.price_history);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
        >
          ← All cars
        </Link>
        <Link
          href={`/car/${car.id}/edit`}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
        >
          Edit details
        </Link>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">
            {car.year} {car.make} {car.model}
          </h1>
          <FavoriteToggle carId={car.id} isFavorite={car.is_favorite} className="text-3xl leading-none text-series-1 hover:opacity-70" />
          {car.is_removed ? (
            <span className="rounded-full bg-critical/10 px-2 py-0.5 text-xs font-medium text-critical">
              Removed from Dubizzle
            </span>
          ) : null}
        </div>
        <a href={car.url} target="_blank" rel="noreferrer" className="break-all text-sm text-series-1 hover:underline">
          {car.url}
        </a>
      </div>

      <form action={setCarRemoved}>
        <input type="hidden" name="car_id" value={car.id} />
        <input type="hidden" name="removed" value={car.is_removed ? "false" : "true"} />
        <button
          type="submit"
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
        >
          {car.is_removed ? "Mark as active again" : "Mark as removed from Dubizzle"}
        </button>
      </form>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-text-secondary">Spec</dt>
          <dd>{car.spec ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">KM</dt>
          <dd className="tabular-nums">{car.km != null ? car.km.toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Cylinders</dt>
          <dd className="tabular-nums">{car.cylinders ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Exterior color</dt>
          <dd>{car.exterior_color ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Interior color</dt>
          <dd>{car.interior_color ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Ad placed</dt>
          <dd>{car.ad_placed_at ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">Latest price</dt>
          <dd className="tabular-nums font-medium">{latest ? formatPrice(latest.price, latest.currency) : "—"}</dd>
        </div>
      </dl>

      {delta != null && delta !== 0 && latest ? (
        <p className={`text-sm ${delta < 0 ? "text-good" : "text-critical"}`}>
          {delta < 0 ? "▼" : "▲"} {formatPrice(Math.abs(delta), latest.currency)} since previous update
        </p>
      ) : null}

      <PriceChart points={car.price_history} />

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-text-secondary">Add a new price update</h2>
        <AddPriceForm carId={car.id} />
      </div>

      <PriceHistoryList carId={car.id} points={car.price_history} />
    </div>
  );
}
