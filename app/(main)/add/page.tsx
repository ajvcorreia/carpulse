import Link from "next/link";
import { redirect } from "next/navigation";
import { getCarByUrl } from "@/lib/data";
import { NewCarForm } from "@/components/NewCarForm";
import { AddPriceForm } from "@/components/AddPriceForm";
import { PriceChart } from "@/components/PriceChart";
import { formatPrice } from "@/lib/format";

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const { url } = await searchParams;

  if (!url) {
    redirect("/");
  }

  const existing = await getCarByUrl(url);

  const backButton = (
    <Link
      href="/"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
    >
      ← All cars
    </Link>
  );

  if (existing) {
    const latest = existing.price_history[existing.price_history.length - 1];
    return (
      <div className="space-y-6">
        {backButton}
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">
            {existing.year} {existing.make} {existing.model}
          </h1>
          <p className="text-sm text-text-secondary">
            Already tracked since {new Date(existing.created_at).toLocaleDateString()}.{" "}
            <Link href={`/car/${existing.id}`} className="underline">
              View full history
            </Link>
          </p>
        </div>

        {latest ? (
          <p className="text-sm text-text-secondary">
            Latest known price: <span className="tabular-nums font-medium text-text-primary">{formatPrice(latest.price, latest.currency)}</span>
          </p>
        ) : null}

        <PriceChart points={existing.price_history} />

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-text-secondary">Add a new price update</h2>
          <AddPriceForm carId={existing.id} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backButton}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">New car</h1>
        <p className="break-all text-sm text-text-secondary">{url}</p>
      </div>
      <NewCarForm url={url} />
    </div>
  );
}
