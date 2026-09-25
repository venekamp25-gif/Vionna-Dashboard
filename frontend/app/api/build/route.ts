import { execSync } from "node:child_process";

/**
 * Which build is live: `{ sha, builtAt, source }`, fixed at BUILD time
 * (force-static → prerendered once per deploy, served as a static file).
 *
 * Why a route and not public/build.json: Netlify never served a file that
 * next.config.ts wrote into public/ during the build (2026-09-25, 404 after
 * the deploy), so the "newer build is live" banner stayed inert.
 *
 * Deterministic sources only. A value that could differ between two
 * instances of the same deploy would make every tab nag for no reason, so
 * no random ids: Netlify's COMMIT_REF, else its DEPLOY_ID, else git, else
 * "dev" (the banner then simply never shows).
 */
export const dynamic = "force-static";
export const revalidate = false;

function resolve(): { sha: string; source: string } {
  const env = (name: string) => (process.env[name] || "").trim();
  if (env("COMMIT_REF")) return { sha: env("COMMIT_REF").slice(0, 12), source: "COMMIT_REF" };
  if (env("NEXT_PUBLIC_BUILD_SHA") && env("NEXT_PUBLIC_BUILD_SHA") !== "dev") {
    return { sha: env("NEXT_PUBLIC_BUILD_SHA").slice(0, 12), source: "NEXT_PUBLIC_BUILD_SHA" };
  }
  if (env("DEPLOY_ID")) return { sha: env("DEPLOY_ID").slice(0, 12), source: "DEPLOY_ID" };
  try {
    const out = execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (out) return { sha: out, source: "git" };
  } catch {
    /* no git on the build machine */
  }
  return { sha: "dev", source: "none" };
}

const BUILD = { ...resolve(), builtAt: new Date().toISOString() };

export function GET() {
  return Response.json(BUILD, { headers: { "Cache-Control": "no-store" } });
}
