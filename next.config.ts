import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Shared workspace package ships TypeScript source (no build step).
  transpilePackages: ["@serviceos/contracts"],
  // The sandbox preview serves the app from a *.space-z.ai domain while the
  // dev server was started on localhost — allow that origin for HMR assets.
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
// restart nudge
