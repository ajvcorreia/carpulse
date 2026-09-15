"use client";

import { useState } from "react";

export function CopyLinkButton({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (non-secure context, permissions denied) —
      // nothing sensible to fall back to, so just leave the button inert.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy listing link"}
      aria-label="Copy listing link"
      className={className}
    >
      {copied ? "✓" : "🔗"}
    </button>
  );
}
