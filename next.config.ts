import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Add your machine's LAN IP here too if you want to reach the dev server
  // from another device (e.g. testing the mobile layout on a phone).
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.10.189"],
  // Traces only the node_modules a production run actually needs into
  // .next/standalone, so the Docker image doesn't need the full node_modules
  // tree copied in.
  output: "standalone",
};

export default nextConfig;
