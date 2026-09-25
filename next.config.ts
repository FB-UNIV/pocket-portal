import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security/csp";

const nextConfig: NextConfig = {
  // Standalone output produces a minimal, self-contained server bundle
  // (node_modules pruned to only what's needed) for the Docker image.
  //
  // Note for anyone wondering why scripts/migrate.mjs isn't covered by this:
  // Next bundles drizzle-orm and postgres into the server chunks, so neither
  // is emitted as a resolvable package in the standalone node_modules.
  // outputFileTracingIncludes can force individual *files* in, but not a
  // working package (no package.json, so the import still fails). The
  // Dockerfile copies both packages explicitly instead.
  output: "standalone",
  // The portal never uses next/image, so Next's optional image optimiser
  // (sharp, with LGPL-3.0 libvips binaries) stays out of the standalone
  // output and the image: less native code, and no LGPL binary to
  // redistribute. /_next/image isn't available as a result.
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
  // ...and the optimisation route off, so /_next/image answers 404 rather
  // than failing every image without sharp.
  images: { unoptimized: true },
  // No `X-Powered-By: Next.js` advertising the stack.
  poweredByHeader: false,
  // On every response, static assets included; the per-request CSP is set
  // in src/proxy.ts.
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
