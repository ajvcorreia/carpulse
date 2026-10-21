"use client";

import { useEffect, useState, useTransition } from "react";
import { undoLastChangeAction } from "@/lib/actions";
import type { UndoEntry } from "@/lib/undo";

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// The most recent change on the dashboard, with a button to undo it (see
// lib/undo.ts). Undoing reveals the change before it, so it can be pressed
// repeatedly to step back.
export function UndoBar({ last }: { last: UndoEntry | null }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // The "Undone: …" note fades after a few seconds, so it never sits next to
  // a newer change it doesn't belong to.
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [message]);

  if (!last && !message) return null;

  function undo() {
    if (!last) return;
    setMessage(null);
    startTransition(async () => {
      const result = await undoLastChangeAction(last.id);
      setMessage(result.ok ? { ok: true, text: `Undone: ${result.label}.` } : { ok: false, text: result.error });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
      {last ? (
        <>
          <span>
            Last change: {last.label} · <span suppressHydrationWarning>{timeAgo(last.created_at)}</span>
          </span>
          <button
            type="button"
            onClick={undo}
            disabled={pending}
            className="rounded-lg border border-border bg-surface px-3 py-1 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary disabled:opacity-60"
          >
            {pending ? "Undoing…" : "Undo"}
          </button>
        </>
      ) : null}
      {message ? <span className={message.ok ? "" : "text-critical"}>{message.text}</span> : null}
    </div>
  );
}
