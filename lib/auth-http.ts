import { NextResponse } from "next/server";
import { isHttps } from "@/lib/auth";

// Shared by the sign-in pages' form handlers (app/login/**/route.ts).

// A relative redirect, so it stays on whatever host the browser used
// (the app can't tell its public address from behind Cloudflare).
export function seeOther(location: string) {
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

function requestHost(headers: Headers) {
  return headers.get("x-forwarded-host")?.split(",")[0].trim() || headers.get("host") || "";
}

// Refuses a form posted from another site (browsers send Origin with every
// POST). Server actions get the same check from Next itself.
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === requestHost(req.headers);
  } catch {
    return false;
  }
}

// The address links in an email should use when Settings has no app URL.
export function requestOrigin(headers: Headers) {
  return `${isHttps(headers) ? "https" : "http"}://${requestHost(headers)}`;
}

export function formText(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}
