"use client";

import { useEffect } from "react";

export const SELECTED_STORAGE_KEY = "dubbizlewatch:selected";

// A page load runs this reliably every time, regardless of how the tab got
// here — single tap, middle-click, right-click -> "Open in new tab", iOS
// long-press -> "Open in New Tab"/"Open in Background". Trying to catch the
// triggering gesture itself (mousedown/touchstart) turned out not to be
// reliable enough on real iOS Safari, so this sidesteps that entirely: the
// browser always has to load *some* page at the href before anything else
// happens, so put the marking there instead.
export function OpenListingRedirect({ carId, url }: { carId: string; url: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_STORAGE_KEY, carId);
    } catch {
      // localStorage unavailable — the redirect below still works, just
      // without the "which one was I looking at" highlight back on the list.
    }
    window.location.replace(url);
  }, [carId, url]);

  return <p className="p-6 text-sm text-text-secondary">Opening listing…</p>;
}
