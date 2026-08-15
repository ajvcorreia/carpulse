import Link from "next/link";
import { notFound } from "next/navigation";
import { getCarWithPrices } from "@/lib/data";
import { EditCarForm } from "@/components/EditCarForm";

export default async function EditCarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const car = await getCarWithPrices(id);

  if (!car) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/car/${car.id}`}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
      >
        ← Back to car
      </Link>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">
          Edit {car.year} {car.make} {car.model}
        </h1>
        <p className="text-sm text-text-secondary">
          Price history isn&apos;t edited here — use &ldquo;Add a new price update&rdquo; on the car page for
          that.
        </p>
      </div>

      <EditCarForm car={car} />
    </div>
  );
}
