import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/**
 * The build's commit sha, offered to the bundle as NEXT_PUBLIC_BUILD_SHA so
 * the header can show which build a tab runs (components/UpdateBanner,
 * lib/buildInfo). Netlify provides COMMIT_REF; a local build asks git;
 * anything else is "dev". The live build itself is served by
 * app/api/build/route.ts (prerendered per deploy) — a file written into
 * public/ here was never served by Netlify (2026-09-25).
 */
function buildSha(): string {
  const fromEnv = (process.env.COMMIT_REF || process.env.NEXT_PUBLIC_BUILD_SHA || "").trim();
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha(),
  },
};

export default nextConfig;
