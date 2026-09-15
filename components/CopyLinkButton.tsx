"use client";

import { useState } from "react";

// navigator.clipboard only exists in a secure context (https:, or
// http://localhost) — this app is normally reached over plain HTTP via a LAN
// IP, which the browser treats as insecure, so that API is undefined there
// and writeText throws immediately. The old-school execCommand("copy") via a
// hidden textarea still works in that case, so it's the real path this app
// needs, not just a defensive fallback.
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy method below
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function CopyLinkButton({ url, className }: { url: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await copyToClipboard(url);
    setStatus(ok ? "copied" : "failed");
    setTimeout(() => setStatus("idle"), 1500);
  }

  const label = status === "copied" ? "Copied!" : status === "failed" ? "Couldn't copy" : "Copy listing link";

  return (
    <button type="button" onClick={handleCopy} title={label} aria-label="Copy listing link" className={className}>
      {status === "copied" ? "✓" : status === "failed" ? "✕" : "🔗"}
    </button>
  );
}
