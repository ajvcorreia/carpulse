import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Add your machine's LAN IP here too if you want to reach the dev server
  // from another device (e.g. testing the mobile layout on a phone).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
