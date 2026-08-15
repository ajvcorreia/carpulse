import { notFound } from "next/navigation";
import { getCarUrl } from "@/lib/data";
import { OpenListingRedirect } from "@/components/OpenListingRedirect";

export default async function OpenListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = await getCarUrl(id);

  if (!url) {
    notFound();
  }

  return <OpenListingRedirect carId={id} url={url} />;
}
