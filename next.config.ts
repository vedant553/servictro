import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" is for Docker/self-hosted. Vercel handles its own output.
  // output: "standalone",  // disabled for Vercel deployment
  reactStrictMode: false,
  // Shared workspace package ships TypeScript source (no build step).
  transpilePackages: ["@serviceos/contracts"],
  // The sandbox preview serves the app from a *.space-z.ai domain while the
  // dev server was started on localhost — allow that origin for HMR assets.
  allowedDevOrigins: ["*.space-z.ai"],
  // Same-origin API proxy (fallback router). The platform preview gateway and
  // the production ALB route /api/* themselves (XTransformPort query / ALB
  // path rules), so this rewrite is inert there — but for direct-to-web
  // contexts (local standalone server, `next dev`, any host without the
  // gateway) it forwards /api/v1/* to the NestJS API so login and data calls
  // work everywhere without cross-origin setup.
  async rewrites() {
    const api = process.env.API_PROXY_ORIGIN ?? "http://127.0.0.1:4000";
    return [{ source: "/api/v1/:path*", destination: `${api}/api/v1/:path*` }];
  },
};

export default nextConfig;
