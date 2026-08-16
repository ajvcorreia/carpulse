"use client";

import { useEffect } from "react";
import { markCarOpened } from "@/lib/actions";

// A page load runs this reliably every time, regardless of how the tab got
// here — tap, middle-click, right-click -> "Open in new tab", iOS long-press.
// Trying to catch the triggering gesture itself (mousedown/touchstart on the
// dashboard row) wasn't reliable enough on at least one mobile browser, so
// this sidesteps that: the browser always has to load *some* page at the
// href before anything else happens, so the marking lives here — and it's
// recorded server-side (see markCarOpened) rather than in a cookie or
// localStorage, which turned out not to be reliably shared across tabs in
// that same browser either.
export function OpenListingRedirect({ carId, url }: { carId: string; url: string }) {
  useEffect(() => {
    markCarOpened(carId).finally(() => {
      window.location.replace(url);
    });
  }, [carId, url]);

  return <p className="p-6 text-sm text-text-secondary">Opening listing…</p>;
}
