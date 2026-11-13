import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Add your machine's LAN IP here too if you want to reach the dev server
  // from another device (e.g. testing the mobile layout on a phone).
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.10.189", "carpulse.ajvc.net"],
  // Traces only the node_modules a production run actually needs into
  // .next/standalone, so the Docker image doesn't need the full node_modules
  // tree copied in.
  output: "standalone",
  poweredByHeader: false,
  // Browser-side hardening for every response. No full Content-Security-
  // Policy: Next's inline scripts would need nonces on every page; these
  // directives are the ones that don't.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Only ever over HTTPS once seen over HTTPS (ignored on plain-http
          // LAN visits). Not includeSubDomains: other hosts under the same
          // domain may be http-only.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          // Never inside another site's frame (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Listing sites don't get CarPulse's addresses (or a reset link)
          // when you open an ad from here.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
