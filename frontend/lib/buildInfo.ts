/**
 * Which build of the dashboard THIS tab is running, and whether a newer one is
 * live. venek, 2026-09-25: after three deploys in a day the screenshots kept
 * showing the old page — a long-open tab keeps the bundle it loaded (Next's
 * client-side navigation never asks for a new one), so fixes "were live" on
 * Netlify but not in front of the operator. Now the tab compares its own build
 * sha with /build.json (written at build time) and says "reload" when they differ.
 *
 * Dependency-free on purpose: the unit tests run on plain node.
 */

/** The sha baked into this bundle at build time (Netlify's COMMIT_REF). */
export const BUILD_SHA: string = process.env.NEXT_PUBLIC_BUILD_SHA || "dev";

export interface LiveBuild {
  sha: string;
  builtAt?: string;
}

/** True when the tab's bundle is older than what is live. A local dev build
 *  ("dev") or an unreadable /build.json never nags. */
export function isStaleBuild(baked: string, live: string | null | undefined): boolean {
  if (!live || !baked || baked === "dev" || live === "dev") return false;
  return baked !== live;
}

/**
 * Read the live build from /build.json. Never throws: null when the file is
 * missing (older deploy), unreadable, or the network is down.
 */
export async function fetchLiveBuild(
  opts: { fetchImpl?: typeof fetch; base?: string } = {}
): Promise<LiveBuild | null> {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return null;
  try {
    const res = await fetchImpl(`${opts.base ?? ""}/build.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<LiveBuild>;
    if (!data || typeof data.sha !== "string" || !data.sha) return null;
    return { sha: data.sha, builtAt: typeof data.builtAt === "string" ? data.builtAt : undefined };
  } catch {
    return null;
  }
}
