"use client";

import { useRef, useState } from "react";
import { extractUrl } from "@/lib/extract-url";

// The dashboard's "add a car" box. Whatever gets pasted — into the box, or
// with the button straight from the clipboard — is cut down to just the
// listing URL (lib/extract-url.ts).
export function AddUrlForm() {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const checkRef = useRef<HTMLButtonElement>(null);

  function takeLink(text: string) {
    const found = extractUrl(text);
    if (!found) {
      setNote("No link found in what was copied.");
      return;
    }
    setUrl(found);
    setNote(found !== text.trim() ? "Removed the extra text around the link." : null);
    checkRef.current?.focus();
  }

  async function pasteFromClipboard() {
    try {
      takeLink(await navigator.clipboard.readText());
    } catch {
      setNote("Couldn't read the clipboard — paste into the box instead.");
    }
  }

  return (
    <div className="space-y-1">
      <form action="/add" method="GET" className="flex gap-2">
        <input
          name="url"
          type="url"
          required
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setNote(null);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text && extractUrl(text) !== text.trim()) {
              e.preventDefault();
              takeLink(text);
            }
          }}
          placeholder="Paste a car listing URL…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-series-1"
        />
        <button
          type="button"
          onClick={pasteFromClipboard}
          title="Paste the copied link, without any text copied around it"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
        >
          Paste link
        </button>
        <button ref={checkRef} type="submit" className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white">
          Check
        </button>
      </form>
      {note ? (
        <p className="text-xs text-text-secondary" aria-live="polite">
          {note}
        </p>
      ) : null}
    </div>
  );
}
