/**
 * Which build of the dashboard THIS tab is running, and whether a newer one is
 * live. venek, 2026-09-25: after three deploys in a day the screenshots kept
 * showing the old page — a long-open tab keeps the bundle it loaded (Next's
 * client-side navigation never asks for a new one), so fixes "were live" on
 * Netlify but not in front of the operator. Now the tab compares the build it
 * started with against /api/build (fixed per deploy) and says "reload" when
 * they differ.
 *
 * The tab's own build is the sha baked at build time when there is one, else
 * the FIRST value /api/build returned to this tab — so the check works even
 * when nothing could be baked into the bundle (Netlify, 2026-09-25).
 *
 * Dependency-free on purpose: the unit tests run on plain node.
 */

/** The sha baked into this bundle at build time, or "dev". */
export const BUILD_SHA: string = process.env.NEXT_PUBLIC_BUILD_SHA || "dev";

/** Where the tab reads the live build from. */
export const BUILD_ENDPOINT = "/api/build";

export interface LiveBuild {
  sha: string;
  builtAt?: string;
  source?: string;
}

/** True when the tab's bundle is older than what is live. A local dev build
 *  ("dev") or an unreadable live build never nags. */
export function isStaleBuild(baked: string, live: string | null | undefined): boolean {
  if (!live || !baked || baked === "dev" || live === "dev") return false;
  return baked !== live;
}

/** The build this tab should compare against: the baked sha when there is
 *  one, else the first live value the tab saw (null until then). */
export function tabBuild(baked: string, firstSeen: string | null): string | null {
  if (baked && baked !== "dev") return baked;
  return firstSeen && firstSeen !== "dev" ? firstSeen : null;
}

/**
 * Read the live build. Never throws: null when the route is missing (older
 * deploy), unreadable, or the network is down.
 */
export async function fetchLiveBuild(
  opts: { fetchImpl?: typeof fetch; base?: string } = {}
): Promise<LiveBuild | null> {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return null;
  try {
    const res = await fetchImpl(`${opts.base ?? ""}${BUILD_ENDPOINT}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<LiveBuild>;
    if (!data || typeof data.sha !== "string" || !data.sha) return null;
    return {
      sha: data.sha,
      builtAt: typeof data.builtAt === "string" ? data.builtAt : undefined,
      source: typeof data.source === "string" ? data.source : undefined,
    };
  } catch {
    return null;
  }
}
