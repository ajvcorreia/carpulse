"use client";

import { useEffect } from "react";

export const SELECTED_COOKIE = "dubbizlewatch_selected";

// A page load runs this reliably every time, regardless of how the tab got
// here — tap, middle-click, right-click -> "Open in new tab", iOS long-press.
// Trying to catch the triggering gesture itself (mousedown/touchstart on the
// dashboard row) turned out not to be reliable enough on some mobile
// browsers, so this sidesteps that: the browser always has to load *some*
// page at the href before anything else happens, so the marking lives here.
//
// Uses a cookie rather than localStorage to relay "which car" back to the
// dashboard tab — cookies go through the OS-level cookie jar, which is
// shared across a browser's tabs far more reliably than localStorage, which
// some mobile browsers partition per tab/webview.
export function OpenListingRedirect({ carId, url }: { carId: string; url: string }) {
  useEffect(() => {
    document.cookie = `${SELECTED_COOKIE}=${carId}; path=/; max-age=300; SameSite=Lax`;
    window.location.replace(url);
  }, [carId, url]);

  return <p className="p-6 text-sm text-text-secondary">Opening listing…</p>;
}
