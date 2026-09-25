/**
 * Read a competitor's Shopify product from the OPERATOR'S browser.
 *
 * Why: shops rate-limit or block our droplet (a datacenter IP) with HTTP 429 /
 * Cloudflare walls, while the same URL answers a normal browser at once
 * (aorabrand.co, 2026-09-24: 200 from a laptop, 429 for the droplet). Shopify's
 * `/products/<handle>.json` sends `access-control-allow-origin: *`, so the
 * dashboard page itself may fetch it — from the worker's residential IP — and
 * hand the JSON to `/api/scrape_manual`, which validates and normalises it
 * exactly like a pasted one. Zero clicks instead of the 30-second paste.
 *
 * Dependency-free on purpose: the unit tests run on plain node.
 */

export type BrowserFetchResult =
  | { ok: true; json: string; url: string }
  | { ok: false; reason: string; url: string | null };

/** Largest product JSON we accept from the browser (real ones are < 500 KB). */
export const BROWSER_FETCH_MAX_BYTES = 5_000_000;

/**
 * The `/products/<handle>.json` URL for a product page URL, or null when the
 * input is not an http(s) product URL. Mirrors the backend's normalisation:
 * tracking query + fragment dropped, `/collections/x/products/y` → `/products/y`,
 * a locale prefix (`/en-us/products/y`) is kept because the shop serves it.
 */
export function productJsonUrl(originalUrl: string): string | null {
  let u: URL;
  try {
    u = new URL((originalUrl || "").trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  let path = u.pathname.replace(/\/+$/, "");
  path = path.replace(/^\/collections\/[^/]+\/products\//, "/products/");
  if (!/\/products\/[^/]+$/.test(path.replace(/\.json$/, ""))) return null;
  if (!path.endsWith(".json")) path += ".json";
  u.pathname = path;
  u.search = "";
  u.hash = "";
  return u.toString();
}

/** True when the text parses as a Shopify product JSON (wrapped or bare). */
export function looksLikeShopifyProductJson(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;
  const base = (obj.product && typeof obj.product === "object" ? obj.product : obj) as Record<string, unknown>;
  return Array.isArray(base.variants) || Array.isArray(base.options);
}

/** Plain text of a Shopify body_html, to judge whether the .json said anything. */
export function bodyHtmlText(bodyHtml: string | null | undefined): string {
  return (bodyHtml || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Below this many characters the .json told us nothing about the product:
 *  the shop keeps its description in theme sections, so the PAGE is the source. */
export const BODY_TEXT_THIN = 200;

/** The product page's own URL (query/fragment dropped), or null. */
export function productPageUrl(originalUrl: string): string | null {
  const j = productJsonUrl(originalUrl);
  return j ? j.replace(/\.json$/, "") : null;
}

export type BrowserHtmlResult = { ok: true; html: string; url: string } | { ok: false; reason: string; url: string | null };

/**
 * Fetch the product PAGE (html) from this browser, for shops whose .json has
 * no description. Shopify serves the page cross-origin as well. Never throws.
 */
export async function fetchPageHtmlFromBrowser(
  originalUrl: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<BrowserHtmlResult> {
  const url = productPageUrl(originalUrl);
  if (!url) return { ok: false, reason: "this is not a /products/<handle> URL", url: null };
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return { ok: false, reason: "no fetch available in this browser", url };
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000) : null;
  try {
    const res = await fetchImpl(url, {
      mode: "cors",
      credentials: "omit",
      headers: { Accept: "text/html" },
      signal: ctrl?.signal,
    });
    if (!res.ok) return { ok: false, reason: `the shop answered your browser with HTTP ${res.status}`, url };
    const html = await res.text();
    if (html.length > 3_000_000) return { ok: false, reason: "the page is too large to read", url };
    if (!/<(?:html|body|main)\b/i.test(html)) return { ok: false, reason: "the answer was not a web page", url };
    return { ok: true, html, url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: ctrl?.signal.aborted ? "no answer within 20 seconds" : msg || "blocked", url };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetch the product JSON from this browser. Never throws: a blocked, timed-out
 * or non-JSON answer comes back as `{ok:false, reason}` so the caller can fall
 * through to the manual paste with a true sentence about why.
 */
export async function fetchProductJsonFromBrowser(
  originalUrl: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<BrowserFetchResult> {
  const url = productJsonUrl(originalUrl);
  if (!url) return { ok: false, reason: "this is not a /products/<handle> URL", url: null };
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return { ok: false, reason: "no fetch available in this browser", url };
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000) : null;
  try {
    const res = await fetchImpl(url, {
      mode: "cors",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: ctrl?.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        reason:
          res.status === 429
            ? "the shop rate-limits your browser too (HTTP 429)"
            : res.status === 404
              ? "the shop has switched off its product JSON (HTTP 404)"
              : `the shop answered your browser with HTTP ${res.status}`,
        url,
      };
    }
    const len = Number(res.headers?.get?.("content-length") ?? 0);
    if (len > BROWSER_FETCH_MAX_BYTES) {
      return { ok: false, reason: `the answer is too large (${len} bytes) to be one product`, url };
    }
    const text = await res.text();
    if (text.length > BROWSER_FETCH_MAX_BYTES) {
      return { ok: false, reason: `the answer is too large (${text.length} bytes) to be one product`, url };
    }
    if (!looksLikeShopifyProductJson(text)) {
      return { ok: false, reason: "the answer was not a Shopify product JSON (a bot check or a login page?)", url };
    }
    return { ok: true, json: text, url };
  } catch (e) {
    const aborted = ctrl?.signal.aborted;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: aborted
        ? "your browser got no answer within 15 seconds"
        : `your browser could not read it (${msg || "blocked by the shop or by CORS"})`,
      url,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
