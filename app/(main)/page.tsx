import Link from "next/link";
import { CarsTable } from "@/components/CarsTable";
import { getCarsWithPrices, getCarFieldOptions } from "@/lib/data";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>;
}) {
  const [cars, options, { highlight }] = await Promise.all([
    getCarsWithPrices(),
    getCarFieldOptions(),
    searchParams,
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 sm:max-w-[1440px]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Tracked cars</h1>
          <div className="flex gap-2">
            <a
              href="/export"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
            >
              Export
            </a>
            <Link
              href="/import"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
            >
              Import
            </Link>
          </div>
        </div>
        <form action="/add" method="GET" className="flex gap-2">
          <input
            name="url"
            type="url"
            required
            placeholder="Paste a car listing URL…"
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-series-1"
          />
          <button type="submit" className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white">
            Check
          </button>
        </form>
      </div>

      <CarsTable cars={cars} options={options} highlightId={highlight} />
    </div>
  );
}
