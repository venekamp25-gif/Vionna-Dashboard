/**
 * Why a /api/scrape call failed, from the message text alone.
 *
 * The scraper runs from the droplet's datacentre IP, and competitor shops
 * rate-limit that IP rather than our code (bug #34: murci.co.uk answered
 * HTTP 429 to the droplet and HTTP 200 to the very same requests from another
 * IP). No frontend change fixes that. But the manual-paste fallback fetches
 * the product from the employee's OWN browser — a residential IP the shop
 * answers normally — so a rate-limited import is one paste away from working.
 * Telling the two failure shapes apart is what lets GenerateStep open that
 * paste step immediately instead of parking the worker on a dead end.
 *
 * The string we classify is whatever `call()` in lib/api.ts threw, i.e. the
 * backend's JSON body wrapped in a status line:
 *
 *   API /api/scrape → 429: {"error": "This shop is rate-limiting our scraper
 *   (HTTP 429 — too many requests). Try again in about 60s. …"}
 */
export type ScrapeFailure = "rate-limit" | "block" | "other";

/**
 * The shop answered us, it just refused this IP for now (HTTP 429) — either a
 * real 429 or the host-wide cooldown _scrape_get returns while a host is
 * cooling down (server.py:1404). Matches both the wrapped status line and the
 * backend's own wording, so a reworded message doesn't silently stop matching.
 */
export const RATE_LIMIT_PATTERN =
  /→ 429|rate-limiting|rate limited|too many requests|cooling down/i;

/** Anti-bot wall, WAF, geo-block or login gate — manual paste helps here too. */
export const BLOCKED_PATTERN =
  /cloudflare|anti-bot|blocking|cdn|geo-restrict|authentication|private|preventing|forbidden/i;

export function classifyScrapeError(message: string | null | undefined): ScrapeFailure {
  const msg = message ?? "";
  // Rate-limit first: the 429 body mentions our scraper being refused, which
  // would also trip a couple of the broader BLOCKED_PATTERN words.
  if (RATE_LIMIT_PATTERN.test(msg)) return "rate-limit";
  if (BLOCKED_PATTERN.test(msg) || msg.startsWith("API /api/scrape")) return "block";
  return "other";
}
