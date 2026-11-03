"use client";

import { useRef, useState } from "react";
import type { CarPhoto } from "@/lib/types";

// The car's saved listing photos (lib/photos.ts) — or, on the add form,
// `urls` straight from the listing before anything is saved — one at a time.
// Arrows on either side (wrapping around), plus the keyboard arrows once it
// has focus and a swipe on touch screens. Clicking the photo opens it full
// size. `imageHeight` (px) fixes the photo's height instead of a 4:3 box.
//
// With `onSetMain`, the photo on show can be made the main one — the first,
// what the carousel opens on. It's told the photo's index and resolves to an
// error message, if any; on success the carousel steps to the (new) first.
export function PhotoCarousel({
  photos,
  urls,
  label,
  imageHeight,
  onSetMain,
}: {
  photos?: CarPhoto[];
  urls?: string[];
  label: string;
  imageHeight?: number;
  onSetMain?: (index: number) => Promise<string | undefined> | string | undefined;
}) {
  const [index, setIndex] = useState(0);
  const [settingMain, setSettingMain] = useState(false);
  const [mainError, setMainError] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

  const sources = photos
    ? photos.map((p) => ({ key: p.id, src: `/photos/${p.id}` }))
    : (urls ?? []).map((u) => ({ key: u, src: u }));
  const count = sources.length;
  if (count === 0) return null;
  // The list can shrink under us (a merge, a refresh) — stay in range.
  const current = Math.min(index, count - 1);
  const go = (step: number) => {
    setMainError(null);
    setIndex((current + step + count) % count);
  };

  async function makeMain() {
    if (!onSetMain) return;
    setSettingMain(true);
    setMainError(null);
    const error = await onSetMain(current);
    setSettingMain(false);
    if (error) setMainError(error);
    else setIndex(0);
  }

  const arrowClass =
    "absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl leading-none text-white hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={`${label} photos`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (count < 2) return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        }
      }}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null || count < 2) return;
        if (Math.abs(end - start) > 40) go(end < start ? 1 : -1);
      }}
      className="relative w-full overflow-hidden rounded-lg border border-border bg-black/5 outline-none focus-visible:border-series-1"
    >
      <a href={sources[current].src} target="_blank" rel="noreferrer" title="Open full size">
        {/* eslint-disable-next-line @next/next/no-img-element -- served as-is; next/image would only re-encode it */}
        <img
          key={sources[current].key}
          src={sources[current].src}
          alt={`${label} — photo ${current + 1} of ${count}`}
          referrerPolicy="no-referrer"
          style={imageHeight ? { height: imageHeight } : undefined}
          className={`w-full object-contain ${imageHeight ? "" : "aspect-[4/3]"}`}
        />
      </a>
      {count > 1 ? (
        <>
          <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`${arrowClass} left-2`}>
            ‹
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`${arrowClass} right-2`}>
            ›
          </button>
          <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs tabular-nums text-white">
            {current + 1} / {count}
          </span>
          {/* Warm the cache for the next photo so stepping through doesn't stall. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- preload only */}
          <img src={sources[(current + 1) % count].src} alt="" aria-hidden referrerPolicy="no-referrer" className="hidden" />
        </>
      ) : null}
      {onSetMain && count > 1 ? (
        current === 0 ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
            ★ Main photo
          </span>
        ) : (
          <button
            type="button"
            onClick={makeMain}
            disabled={settingMain}
            title="Show this photo first, wherever the car's photos appear"
            className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60"
          >
            {settingMain ? "Saving…" : "☆ Set as main photo"}
          </button>
        )
      ) : null}
      {mainError ? (
        <span role="alert" className="absolute inset-x-2 bottom-2 mr-14 rounded bg-critical px-2 py-1 text-xs text-white">
          {mainError}
        </span>
      ) : null}
    </div>
  );
}
