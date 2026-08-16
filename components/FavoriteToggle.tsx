"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCarFavorite } from "@/lib/actions";

export function FavoriteToggle({
  carId,
  isFavorite,
  className,
  children,
}: {
  carId: string;
  isFavorite: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await setCarFavorite(carId, !isFavorite);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      className={className}
    >
      {children ?? (isFavorite ? "★" : "☆")}
    </button>
  );
}
