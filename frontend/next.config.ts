import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The build's commit sha, baked into the bundle (NEXT_PUBLIC_BUILD_SHA) AND
 * written to public/build.json, so a running tab can tell whether a newer
 * build is live (components/UpdateBanner). Netlify provides COMMIT_REF; a
 * local build asks git; anything else is "dev" (never nags).
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

const sha = buildSha();
try {
  mkdirSync(join(process.cwd(), "public"), { recursive: true });
  writeFileSync(
    join(process.cwd(), "public", "build.json"),
    JSON.stringify({ sha, builtAt: new Date().toISOString() }) + "\n"
  );
} catch {
  /* read-only checkout — the banner then simply never shows */
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: sha,
  },
};

export default nextConfig;
