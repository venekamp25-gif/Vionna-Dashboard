/**
 * API client — talks to the Python Flask backend.
 *
 * Backend URL is configurable via NEXT_PUBLIC_BACKEND_URL env var so we can
 * point at localhost during dev and a real server (DigitalOcean droplet) in prod.
 */
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") || "http://localhost:5000";

/** OAuth start URL for connecting / re-authorising a store's Shopify token (#8). */
export function backendAuthUrl(store: string): string {
  return `${BACKEND_URL}/auth/${store}`;
}

// Short-lived token for the droplet's mutation endpoints (publish / backfill).
// Minted server-side by /api/droplet-token so the secret never reaches the
// browser. Cached and reused across a publish run (which fires many per-variant
// calls) and refreshed well before the 5-minute server-side expiry.
let _dropletToken: { value: string; expiresAt: number } | null = null;

// Friendly message shown when the droplet rejects the session token even after a
// fresh re-mint — almost always a stale tab or a logged-out/expired session.
const SESSION_EXPIRED_MESSAGE =
  "Your session has expired or this page is out of date. Please refresh the page (Ctrl+Shift+R), log in again if needed, and try publishing once more.";

async function getDropletToken(force = false): Promise<string | null> {
  const now = Date.now();
  if (!force && _dropletToken && _dropletToken.expiresAt > now + 30_000) return _dropletToken.value;
  try {
    const res = await fetch("/api/droplet-token", { credentials: "include" });
    if (!res.ok) {
      _dropletToken = null;
      return null;
    }
    const { token } = (await res.json()) as { token?: string };
    if (!token) {
      _dropletToken = null;
      return null;
    }
    _dropletToken = { value: token, expiresAt: now + 4 * 60_000 }; // refresh before the 5-min expiry
    return token;
  } catch {
    _dropletToken = null;
    return null;
  }
}

// Transient backend hiccups — the ~2-3s window while the droplet restarts after a
// self-update, or a brief nip.io DNS blip — surface as a thrown network error
// ("Failed to fetch") or a 502/503/504. For idempotent reads (GET) we retry a
// couple of times with a short backoff so the user doesn't see a spurious
// failure. POSTs are NEVER retried on a network error: a half-completed publish
// must not be silently repeated (would risk duplicate products).
const TRANSIENT_READ_RETRIES = 2; // extra attempts on top of the first, GET only
const isTransientStatus = (s: number) => s === 502 || s === 503 || s === 504;

async function call<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal; authed?: boolean }
): Promise<T> {
  const fetchOnce = (token: string | null) => {
    const headers: Record<string, string> = {};
    if (init?.body) headers["Content-Type"] = "application/json";
    if (token) headers["X-Droplet-Token"] = token;
    return fetch(`${BACKEND_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: Object.keys(headers).length ? headers : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      credentials: "include",
      signal: init?.signal,
    });
  };

  const isRead = (init?.method ?? "GET") === "GET";

  // Runs fetchOnce, transparently retrying transient failures for reads only.
  const fetchResilient = async (token: string | null): Promise<Response> => {
    const maxExtra = isRead ? TRANSIENT_READ_RETRIES : 0;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxExtra; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
      try {
        const r = await fetchOnce(token);
        if (isRead && isTransientStatus(r.status)) {
          lastErr = new Error(`HTTP ${r.status}`);
          continue; // server briefly unavailable (e.g. restarting) — retry
        }
        return r;
      } catch (e) {
        if (init?.signal?.aborted) throw e; // caller cancelled — never retry
        lastErr = e; // network error ("Failed to fetch") — retry (reads only)
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };

  let res: Response;
  if (init?.authed) {
    res = await fetchResilient(await getDropletToken());
    // A 401 means the gate rejected the token (missing/expired/stale cache).
    // Re-mint a fresh token once and retry before surfacing an error — this
    // transparently recovers an expired session token mid-publish.
    if (res.status === 401) {
      const fresh = await getDropletToken(true);
      if (fresh) res = await fetchResilient(fresh);
    }
    if (res.status === 401) {
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
  } else {
    res = await fetchResilient(null);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ── Types matching server.py responses ──
export interface BackendStatus {
  dk: boolean;
  fr: boolean;
  fi: boolean;
  anthropic: boolean;
}

export interface ScrapedProduct {
  product?: {
    title?: string;
    handle?: string;
    options?: { name: string; values: string[]; position?: number }[];
    variants?: {
      id?: number;
      option1?: string | null;
      option2?: string | null;
      option3?: string | null;
      price: string;
      featured_image?: { id?: number; src?: string; variant_ids?: number[] } | null;
    }[];
    images?: {
      id?: number;
      src: string;
      variant_ids?: number[];
      position?: number;
    }[];
  };
  /** Competitor's size chart scraped from the product page (headers + rows of cm
   *  values), or null when none was found. Headers are localised at publish. */
  size_chart?: SizeChart | null;
  /** 'found' = chart read; 'unread' = a chart clearly EXISTS but we couldn't read
   *  it (unknown app etc.) — worker can flag it; 'none' = genuinely no chart. */
  size_chart_status?: "found" | "unread" | "none";
  /** What tipped us off that an unread chart exists (e.g. "SizeFox app"). */
  size_chart_hint?: string | null;
  error?: string;
}

/** A scraped size chart: column headers + measurement rows (e.g. ["XS","92 cm","88 cm"]). */
export interface SizeChart {
  headers: string[];
  rows: string[][];
}

export interface NamesResponse {
  names: string[];
  error?: string;
}

export interface GenerateResponse {
  description?: string;
  meta_description?: string;
  m_title_specs?: string;
  error?: string;
}

export type GenerateField = "description" | "meta_description" | "m_title_specs";

export interface HiggsfieldResponse {
  urls?: string[];
  prompt_used?: string;
  error?: string;
}

export interface PublishResponse {
  success: boolean;
  collection_id?: number;
  collection_url?: string | null;
  products_created?: number;
  product_ids?: number[];
  product_urls?: string[];
  metafield_errors?: string[];
  error?: string;
}

export interface PublishStartStoreResponse {
  success: boolean;
  collection_id?: number | null;
  actual_handle?: string;
  collection_url?: string | null;
  reused?: boolean;
  error?: string;
}

export interface HistoryEntry {
  timestamp: string;            // ISO UTC
  store: "dk" | "fr" | "fi";
  product_name: string;
  color: string;
  product_id?: number | null;
  product_url?: string | null;
  /** Competitor URL this product was imported from — internal admin only,
   *  never in the Shopify feed/metafields (Google Merchant policy). */
  source_url?: string | null;
  collection_handle?: string | null;
  image_count?: number;
  metafield_errors?: string[];
}

export interface PublishCreateVariantResponse {
  success: boolean;
  product_id?: number;
  product_url?: string;
  metafield_errors?: string[];
  error?: string;
  /** True only if the product was actually flipped to LIVE (status=active). False when
   *  activate wasn't requested, the flip failed, or the product was reused (retry). */
  activated?: boolean;
  /** True when an existing product at this handle was reused (retry/dedup), not created. */
  reused?: boolean;
}

// ── Keyword / SEO backfill (regenerate copy for already-listed products) ──
export interface BackfillColour {
  id: string;
  handle: string;
  color: string;
  status: string;
}
export interface BackfillGroup {
  /** Grouping key (theme.siblings handle, or title). Stable id for one dress. */
  key: string;
  product_name: string;
  image: string;
  siblings_handle: string;
  /** Every colour-product id of this dress — copy is written to all of them. */
  product_ids: string[];
  colours: BackfillColour[];
  /** True when every colour-product carries the custom.keyword_backfilled marker. */
  handled: boolean;
  /** Date the marker was set (when handled), e.g. "2026-06-19". */
  backfilled_at?: string;
  current: {
    description_html: string;
    description_text: string;
    meta_description: string;
    m_title_specs: string;
  };
}
export interface BackfillListResponse {
  store: "dk" | "fr" | "fi";
  total_products: number;
  total_dresses: number;
  groups: BackfillGroup[];
  error?: string;
}
export interface BackfillApplyResponse {
  store: string;
  applied: number;
  failed: number;
  results: { id: string; ok: boolean; errors: string[] }[];
  error?: string;
}

// ── Catalogue maintenance background jobs ──
export type CatalogJobType =
  | "bold_cleanup"
  | "channels"
  | "cutline"
  | "dedup"
  | "relink"
  | "fix_titles_scan"
  | "fix_titles_apply"
  | "fix_flagged";
export interface CatalogJob {
  id: string;
  type: CatalogJobType;
  store: "dk" | "fr" | "fi";
  status: "running" | "done" | "error";
  total: number | null;
  processed: number;
  changed: number;
  skipped: number;
  errors: string[];
  summary: string;
  started_at: string;
  finished_at: string | null;
  error?: string;
}

// ── Public API ──
export const api = {
  status: () => call<BackendStatus>("/api/status"),

  /** Classify the source store of a product URL (dropshipper / own-stock / unknown)
   *  by parsing its shipping policy. Used to warn at the import step. */
  classifyShipping: (url: string) =>
    call<{
      label: "Dropshipper" | "Eigen voorraad" | "Mogelijk eigen merk" | "Onbekend";
      detail: string;                                   // "7-14d"
      source:
        | "structured" | "policy" | "policy-js" | "llm" | "llm-sonnet" | "vision"
        | "manual-blocklist" | "brand-signals" | "none";
      confidence: "high" | "medium" | "low" | "none";
      /** SimilarWeb market-size gate (DSA rule: visits × 2% × AOV ≥ €300k/mo).
       *  null when the check itself couldn't run (no token / actor error). */
      traffic?: {
        visits: number;
        est_monthly_eur: number;
        market_ok: boolean;
        threshold_eur: number;
      } | null;
      error?: string;
    }>(`/api/classify_shipping?url=${encodeURIComponent(url)}`),

  /** Post-publish verification: re-read created products and confirm images /
   *  cutline / sales channels / variants. Also used by the catalog-audit panel. */
  verifyProducts: (store: "dk" | "fr" | "fi", product_ids: (number | string)[]) =>
    call<{
      products: {
        id: string; title: string; status: string;
        images: number; cutline: string; channels: number; variants: number;
        issues: { level: "warn" | "fail"; msg: string }[];
      }[];
      error?: string;
    }>("/api/verify_products", { method: "POST", body: { store, product_ids } }),

  /** Re-attempt the auto-fixable post-publish issues (re-publish to sales channels). Gated. */
  retryFix: (store: "dk" | "fr" | "fi", product_ids: (number | string)[]) =>
    call<{ success: boolean; fixed: number; errors: string[]; error?: string }>(
      "/api/retry_fix",
      { method: "POST", body: { store, product_ids }, authed: true }
    ),

  /** Catalogue audit (#2): scan a store for missing cutlines / images, duplicate
   *  products, and active-but-off-channel products. */
  auditCatalog: (store: "dk" | "fr" | "fi") =>
    call<{
      store: string;
      total: number;
      missing_cutline: { count: number; samples: string[] };
      no_images: { count: number; samples: string[] };
      not_on_channels: { count: number; samples: string[] };
      duplicates: { count: number; groups: { base: string; handles: string[] }[] };
      error?: string;
    }>(`/api/audit?store=${store}`),

  /** System health for the admin panel (#7): version, per-store auth, keys, backups. */
  health: () =>
    call<{
      version: string;
      stores: Record<"dk" | "fr" | "fi", boolean>;
      anthropic: boolean;
      higgsfield_cli: boolean;
      backups: { count: number; last: string };
    }>("/api/health"),

  /** Trigger an on-demand local backup snapshot (#9). */
  backupNow: () =>
    call<{ success: boolean; path: string }>("/api/backup_now", { method: "POST", authed: true }),

  /** Download an off-droplet data backup (publish history + bug reports) (#9). */
  exportData: () =>
    call<{ exported_at: string; publish_history: unknown[]; bug_reports: unknown[] }>(
      "/api/export_data",
      { authed: true }
    ),

  scrape: (url: string) =>
    call<ScrapedProduct>("/api/scrape", { method: "POST", body: { url } }),

  /**
   * Manual-paste fallback for shops whose Cloudflare / WAF blocks our scraper.
   * The user opens /products/<handle>.json in their own browser, copies the JSON,
   * and pastes it here. Same product shape as /api/scrape — minus sibling-discovery
   * (which would need the HTML page).
   */
  scrapeManual: (rawJson: string) =>
    call<ScrapedProduct & { source?: string }>(
      "/api/scrape_manual",
      { method: "POST", body: { json: rawJson } }
    ),

  names: (store: "dk" | "fr" | "fi") =>
    call<NamesResponse>("/api/names", { method: "POST", body: { store } }),

  generate: (params: {
    store: "dk" | "fr" | "fi";
    product_name: string;
    product_title: string;
    keywords: string[];
    /** Regenerate only this one field. When omitted, all three fields are generated. */
    only_field?: GenerateField;
    /** Existing values for the OTHER fields, so partial regenerations stay consistent. */
    current_description?: string;
    current_meta_description?: string;
    current_m_title_specs?: string;
    /**
     * Optional list of full product descriptions the user marked as tone references —
     * Claude uses them as style anchors (length, voice, bullet structure).
     */
    tone_references?: string[];
  }) => call<GenerateResponse>("/api/generate", { method: "POST", body: params }),

  /** Translate colour-variant names into a store's language. Dedicated (not folded
   *  into /api/generate) so the model returns them reliably. Response `colors` is
   *  always the same length + order as the request, falling back to the input value
   *  for any colour it couldn't place. */
  translateColors: (params: { store: "dk" | "fr" | "fi"; colors: string[] }) =>
    call<{ colors: string[]; error?: string }>("/api/translate_colors", {
      method: "POST",
      body: params,
    }),

  /** Auto keyword research (DataForSEO) per market, from the product. Derives
   *  local-language seeds (Claude) → keyword ideas + monthly search volume per
   *  store. DORMANT until DATAFORSEO_LOGIN/PASSWORD are set on the server →
   *  returns { configured: false } and callers keep the manual/legacy keywords. */
  researchKeywords: (params: {
    stores: ("dk" | "fr" | "fi")[];
    product_name: string;
    competitor_title: string;
    category?: string;
    description?: string;
    min_volume?: number;
    limit?: number;
  }) =>
    call<{
      configured: boolean;
      message?: string;
      seeds?: Partial<Record<"dk" | "fr" | "fi", string[]>>;
      results?: Partial<
        Record<
          "dk" | "fr" | "fi",
          {
            seeds: string[];
            min_volume?: number;
            recommended_count?: number;
            keywords: {
              keyword: string;
              volume: number | null;
              cpc: number | null;
              competition: string | null;
              intent: string | null;
              recommended?: boolean;
              score?: number;
              seasonality?: {
                peak_month?: string;
                trough_month?: string;
                push_from_month?: string;
                trend?: string;
                seasonal?: boolean;
              } | null;
            }[];
          }
        >
      >;
    }>("/api/research_keywords", { method: "POST", body: params, authed: true }),

  /** Standalone niche keyword research (the DSA strategy): trending high-volume
   *  fashion keywords for a market, with seasonality. Gated (costs API credits). */
  keywordResearchNiche: (params: {
    store: "dk" | "fr" | "fi";
    product_type?: string;
    min_volume?: number;
    target_count?: number;
  }) =>
    call<{
      configured: boolean;
      store?: string;
      product_type?: string;
      seeds?: string[];
      min_volume?: number;
      found?: number;
      recommended_count?: number;
      keywords?: {
        keyword: string;
        volume: number | null;
        cpc: number | null;
        competition: string | null;
        intent: string | null;
        seed?: string;
        recommended?: boolean;
        score?: number;
        seasonality: {
          peak_month?: string;
          trough_month?: string;
          push_from_month?: string;
          trend?: string;
          seasonal?: boolean;
        } | null;
      }[];
    }>("/api/keyword_research_niche", { method: "POST", body: params, authed: true }),

  /** "What to list": product-TYPE view for a market — each type has an English
   *  label + localized term + demand/season + its top keywords. Gated. */
  whatToList: (params: { store: "dk" | "fr" | "fi"; per_type?: number; force?: boolean }) =>
    call<{
      configured: boolean;
      store?: string;
      per_type?: number;
      count?: number;
      from_cache?: boolean;
      cached_at?: string;
      cache_age_seconds?: number;
      recent_total?: number;
      recent_window_days?: number;
      recent_counts?: Record<string, number>;
      live_counts?: Record<string, number>;
      types?: {
        seed: string;
        label: string;
        volume: number | null;
        intent: string | null;
        recommended?: boolean;
        score?: number;
        category?: string | null;
        recent_listed?: number;
        total_live?: number;
        bucket?: "now" | "soon" | "evergreen" | "off";
        seasonality?: {
          peak_month?: string;
          trough_month?: string;
          push_from_month?: string;
          trend?: string;
          seasonal?: boolean;
        } | null;
        keywords: {
          keyword: string;
          volume: number | null;
          intent: string | null;
          seasonality?: {
            peak_month?: string;
            trough_month?: string;
            push_from_month?: string;
            trend?: string;
            seasonal?: boolean;
          } | null;
        }[];
      }[];
    }>("/api/what_to_list", { method: "POST", body: params, authed: true }),

  /** Whether DataForSEO keyword research is configured on the server (non-secret). */
  keywordResearchStatus: () =>
    call<{ configured: boolean; login_hint?: string }>("/api/keyword_research_status", {
      method: "GET",
    }),

  /** Save DataForSEO API credentials to the server .env (gated). The values are
   *  written server-side and never returned; only { ok, configured } comes back. */
  saveDataforseoCredentials: (params: { login: string; password: string }) =>
    call<{ ok?: boolean; configured?: boolean; error?: string }>(
      "/api/save_dataforseo_credentials",
      { method: "POST", body: params, authed: true }
    ),

  higgsfield: (params: {
    prompt_type: number;
    product_type: string;
    image_urls: string[];
    count?: number;
    color?: string;
  }) => call<HiggsfieldResponse>("/api/higgsfield", { method: "POST", body: params }),

  publish: (params: {
    store: "dk" | "fr" | "fi";
    product_name: string;
    description: string;
    meta_description: string;
    m_title_specs: string;
    price: string;
    compare_at_price?: string | null;
    product_type: string;
    colors: string[];
    siblings_handle: string;
    images?: string[];
    images_by_color?: Record<string, string[]>;
  }) => call<PublishResponse>("/api/publish", { method: "POST", body: params, authed: true }),

  publishStartStore: (params: {
    store: "dk" | "fr" | "fi";
    product_name: string;
    siblings_handle: string;
  }) => call<PublishStartStoreResponse>("/api/publish/start_store", { method: "POST", body: params, authed: true }),

  /** Scan a competitor's best-selling page: ordered top products with type/price/
   *  age + per-category counts. Cached 12h server-side; force=1 rescans. */
  bestsellerScan: (domain: string, force = false) =>
    call<{
      ok: boolean;
      domain?: string;
      url?: string;
      blocked?: string;
      error?: string;
      from_cache?: boolean;
      cache_age_seconds?: number;
      count?: number;
      by_category?: Record<string, number>;
      products?: {
        position: number;
        handle: string;
        title: string;
        url: string;
        image: string | null;
        price: string | null;
        product_type: string;
        published_at: string;
        category: string;
      }[];
    }>(`/api/bestseller_scan?domain=${encodeURIComponent(domain)}${force ? "&force=1" : ""}`),

  /** Competitor domains we've imported from before (publish history), most-used first. */
  knownCompetitors: () =>
    call<{ competitors: { domain: string; products: number; last_import: string }[] }>(
      "/api/known_competitors"
    ),

  /** Risers + new entrants on known competitors' bestseller pages vs ~a week ago
   *  (droplet-side weekly snapshots; skips products we already imported). Ranked
   *  with the SAME scoring as What-to-list (season + catalogue gap) for `store`. */
  bestsellerMovers: (store: "dk" | "fr" | "fi" = "dk") =>
    call<{
      movers: {
        domain: string;
        signal: "new" | "riser";
        position: number;
        old_position: number | null;
        handle: string;
        title: string;
        url: string;
        image: string | null;
        price: string | null;
        published_at: string;
        category: string;
        score?: number;
        cat_bucket?: "now" | "soon" | "evergreen" | "off" | null;
        cat_recent?: number;
        cat_live?: number;
      }[];
      baseline: string[];
      store?: string;
      season_source?: "what_to_list" | "live_counts" | "none";
      category_context?: Record<string, { bucket: string | null; recent: number; live: number }>;
      checked: number;
      window_days: number;
    }>(`/api/bestseller_movers?store=${store}`),

  reportBug: (params: {
    title: string;
    description: string;
    page_url?: string;
    reporter_email?: string;
    store?: "dk" | "fr" | "fi";
    screenshot?: string;   // data URL
    /** Snapshot of the current import so import bugs are reproducible. */
    diagnostics?: {
      competitor_url: string | null;
      detected_colors: string[];
      color_count: number;
      sizes: string[];
      selected_stores: string[];
      product_name: string | null;
    };
  }) =>
    call<{ success: boolean; id?: number; error?: string }>("/api/bug_reports", {
      method: "POST",
      body: params,
    }),

  backfillSalesChannels: (store: "dk" | "fr" | "fi") =>
    call<{
      store: string;
      targets: string[];
      successes: number;
      failures_count: number;
      failures: { product_id?: number; title?: string; errors?: string[] }[];
      first_failure_error?: string | null;
      error_summary?: Record<string, number>;
      samples_published?: { id: number; title: string; status: string }[];
      error?: string;
      available_publications?: string[];
    }>(`/api/backfill_sales_channels?store=${store}`, { method: "POST", authed: true }),

  recentDescriptions: (params: { store: "dk" | "fr" | "fi"; limit?: number }) => {
    const qs = new URLSearchParams();
    qs.set("store", params.store);
    if (params.limit) qs.set("limit", String(params.limit));
    return call<{
      store: "dk" | "fr" | "fi";
      items: { title: string; handle: string; created_at: string; description: string }[];
      error?: string;
    }>(`/api/recent_descriptions?${qs.toString()}`);
  },

  history: (params?: { limit?: number; store?: "dk" | "fr" | "fi"; product?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.store) qs.set("store", params.store);
    if (params?.product) qs.set("product", params.product);
    const path = "/api/history" + (qs.toString() ? `?${qs.toString()}` : "");
    return call<{ entries: HistoryEntry[]; total: number; error?: string }>(path);
  },

  publishCreateVariant: (params: {
    store: "dk" | "fr" | "fi";
    product_name: string;
    color: string;
    sizes?: string[];
    description: string;
    meta_description: string;
    m_title_specs: string;
    price: string;
    compare_at_price?: string | null;
    product_type: string;
    images: string[];
    collection_id?: number | null;
    actual_handle: string;
    /** Competitor source URL this product was imported from — logged in publish history. */
    competitorUrl?: string;
    /** Scraped competitor size chart — appended (localised) to the description. */
    size_chart?: SizeChart | null;
    /** Publish LIVE (status=active) instead of draft. Set when "Prepare Meta Ads" is ticked. */
    activate?: boolean;
  }) => call<PublishCreateVariantResponse>("/api/publish/create_variant", { method: "POST", body: params, authed: true }),

  /** Keyword backfill: list a store's products grouped per dress, with current
   *  SEO copy, so keywords can be filled in + copy regenerated for products that
   *  were imported before keyword research. ACTIVE only unless includeDrafts. */
  backfillProducts: (store: "dk" | "fr" | "fi", includeDrafts = false) =>
    call<BackfillListResponse>(
      `/api/backfill/products?store=${store}${includeDrafts ? "&include_drafts=1" : ""}`
    ),

  /** Write regenerated copy to every colour-product of one dress. Pass plain-text
   *  `description` (converted to body_html server-side) OR raw `description_html`
   *  (used to revert to the exact original body). Mutation-gated. */
  backfillApply: (params: {
    store: "dk" | "fr" | "fi";
    product_ids: string[];
    description?: string;
    description_html?: string;
    meta_description?: string;
    m_title_specs?: string;
    /** Tag the product as handled (default true). Pass false to un-mark, e.g. on revert. */
    set_handled?: boolean;
  }) => call<BackfillApplyResponse>("/api/backfill/apply", { method: "POST", body: params, authed: true }),

  /** Start a long-running catalogue-maintenance job (runs in a backend thread so
   *  it can't time out). Returns a job id to poll with catalogJobStatus. */
  catalogJobStart: (store: "dk" | "fr" | "fi", job_type: CatalogJobType) =>
    call<{ job_id: string; status: string; error?: string }>("/api/catalog_job/start", {
      method: "POST",
      body: { store, job_type },
      authed: true,
    }),

  /** Poll a running maintenance job for progress. */
  catalogJobStatus: (id: string) =>
    call<CatalogJob>(`/api/catalog_job/status?id=${encodeURIComponent(id)}`),

  /** All maintenance jobs (newest first), optionally for one store — lets the UI
   *  re-discover running jobs after the modal closes or the page reloads. */
  catalogJobList: (store?: "dk" | "fr" | "fi") =>
    call<{ jobs: CatalogJob[]; error?: string }>(
      `/api/catalog_job/list${store ? `?store=${store}` : ""}`
    ),

  /** Read-only: confirm Meta config + that the token reaches the ad account + page. */
  metaCheck: () => call<MetaCheckResponse>("/api/meta/check"),

  /** Create PAUSED Meta draft campaigns — one per store, with one Flexible ad per colour
   *  variant + per-store ad copy. Gated (session token). Back-compatible with the old
   *  item-level single-colour shape (product_url + image_urls/image_url). */
  metaCreateDraft: (params: {
    product_name: string;
    items: {
      store: string;
      primary_text?: string;
      headline?: string;
      description?: string;
      colors?: { product_url: string; image_urls: string[] }[];
      product_url?: string;
      image_urls?: string[];
      image_url?: string;
    }[];
  }) =>
    call<MetaCreateDraftResponse>("/api/meta/create_draft", {
      method: "POST",
      body: params,
      authed: true,
    }),

  /** Translate the Dutch ad-copy template into fluent ad copy per store-language. */
  generateAdCopy: (params: {
    stores: string[];
    product_name: string;
    product_url: string;
    template?: string;
  }) => call<AdCopyResponse>("/api/generate_ad_copy", { method: "POST", body: params }),

  /** Start the background Meta-draft job (generation + copy + ad creation, paced server-side).
   *  Returns a job_id to poll with metaJobStatus. Gated (session token). */
  metaCreateDraftJob: (params: {
    product_name: string;
    product_type?: string;
    stores: string[];
    color_keys: string[];
    images_by_color: Record<string, string[]>;
    url_by_store_color: Record<string, string[]>;
    /** Per store: localised colour labels aligned with color_keys — so the ad link matches
     *  the real Shopify handle (built from the localised label, e.g. Finnish "musta"). */
    color_labels_by_store?: Record<string, string[]>;
    lifestyle_per_color?: number;
    template?: string;
  }) =>
    call<{ job_id?: string; status?: string; error?: string }>("/api/meta/create_draft_job", {
      method: "POST",
      body: params,
      authed: true,
    }),

  /** Poll a Meta-draft background job (reuses the catalog-job status route). */
  metaJobStatus: (id: string) =>
    call<MetaDraftJob>(`/api/catalog_job/status?id=${encodeURIComponent(id)}`),

  /** Read-only: recent Meta campaigns (id/name/status) — for the link-repair picker. */
  metaCampaigns: () =>
    call<{ campaigns: { id: string; name: string; status: string }[]; count: number }>(
      "/api/meta/campaigns"
    ),

  /** Repair an existing campaign's ad destination links to the REAL per-store product handle.
   *  dry_run (default true) previews without changing anything. Gated. */
  metaFixLinks: (params: {
    campaign_id: string;
    store?: string;
    product_name?: string;
    dry_run?: boolean;
  }) => call<MetaFixLinksResponse>("/api/meta/fix_links", { method: "POST", body: params, authed: true }),
};

export interface MetaFixLinkRow {
  ad_id: string;
  ad_name: string;
  old_link: string;
  new_link: string;
  colour: string | null;
  match: string;
  verified_200: boolean;
  status: string;
  new_ad_id?: string;
  old_paused?: boolean;
}
export interface MetaFixLinksResponse {
  campaign_id?: string;
  campaign_name?: string;
  store?: string;
  product_name?: string;
  dry_run?: boolean;
  fixed?: number;
  manual?: number;
  real_handles?: string[];
  ads?: MetaFixLinkRow[];
  error?: string;
}

export interface MetaDraftResult {
  store: string;
  country: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  creative_ids: string[];
  ad_ids: string[];
  error: string | null;
}
export interface MetaCreateDraftResponse {
  pixel_used?: string | null;
  results?: MetaDraftResult[];
  error?: string;
}
export interface AdCopyEntry {
  primary_text?: string;
  headline?: string;
  description?: string;
  error?: string;
}
export interface MetaDraftJob {
  id: string;
  status: "running" | "done" | "error";
  phase?: string;
  total: number | null;
  processed: number;
  summary: string;
  errors: string[];
  result?: MetaDraftResult[];
  pixel_used?: string | null;
  error?: string;
}
/** Keyed by store ("dk"|"fr"|"fi"); may also carry a top-level `error`. */
export type AdCopyResponse = Record<string, AdCopyEntry | string | undefined>;
export interface MetaCheckResponse {
  config?: Record<string, unknown>;
  account?: { name?: string; account_status?: number } | null;
  page?: { name?: string; id?: string } | null;
  errors?: string[];
  error?: string;
}

export const BACKEND = BACKEND_URL;

// ── Auth: who's logged in (served by Next.js, not the Python backend) ──

/**
 * Soft-redirect to /login when the user's session is gone. Used by
 * fetchCurrentUser (the only call that can return 401) so an expired
 * cookie mid-session shows the login page instead of a silently broken UI.
 *
 * Uses a window-scoped guard so a burst of failing calls (e.g. several
 * components fetching /api/me on mount) only triggers ONE redirect.
 */
function redirectToLoginOnce() {
  if (typeof window === "undefined") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.__vionna_redirecting_to_login) return;
  if (window.location.pathname === "/login") return;
  w.__vionna_redirecting_to_login = true;
  // Preserve where we were so the user can resume after re-login
  const ret = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?return=${ret}`;
}

export async function fetchCurrentUser(): Promise<{ email: string | null }> {
  try {
    const res = await fetch("/api/me", { credentials: "include", cache: "no-store" });
    if (res.status === 401) {
      redirectToLoginOnce();
      return { email: null };
    }
    if (!res.ok) return { email: null };
    return (await res.json()) as { email: string | null };
  } catch {
    return { email: null };
  }
}

// ── Per-user drafts (server-side, keyed by email) ──

export interface DraftLoadResponse<T = unknown> {
  draft: (T & { _saved_at?: string }) | null;
  saved_at?: string;
  error?: string;
}

export const draftsApi = {
  load: <T = unknown>(owner: string) =>
    call<DraftLoadResponse<T>>(`/api/drafts?owner=${encodeURIComponent(owner)}`),

  save: <T = unknown>(owner: string, draft: T) =>
    call<{ success: boolean; saved_at: string; error?: string }>(
      `/api/drafts?owner=${encodeURIComponent(owner)}`,
      { method: "POST", body: draft as unknown }
    ),

  clear: (owner: string) =>
    fetch(`${BACKEND_URL}/api/drafts?owner=${encodeURIComponent(owner)}`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => {}),
};

/** One re-openable past product in the history (metadata only — full data fetched on open). */
export interface ProductSnapshotMeta {
  id: string;
  name: string;
  saved_at: string;
  stores: string[];
  color_count: number;
}

export const snapshotsApi = {
  list: (owner: string) =>
    call<{ snapshots: ProductSnapshotMeta[]; error?: string }>(
      `/api/product_snapshots?owner=${encodeURIComponent(owner)}`
    ),
  save: <T = unknown>(owner: string, data: T) =>
    call<{ success: boolean; id: string; error?: string }>(
      `/api/product_snapshots?owner=${encodeURIComponent(owner)}`,
      { method: "POST", body: data as unknown }
    ),
  get: <T = unknown>(owner: string, id: string) =>
    call<{ snapshot: T | null; error?: string }>(
      `/api/product_snapshots/${encodeURIComponent(id)}?owner=${encodeURIComponent(owner)}`
    ),
};

/** A pending change-plan awaiting the CEO's approval (bug → plan → akkoord → auto-fix). */
export interface PlanEntry {
  id: number;
  bug_id: number | null;
  title: string;
  summary: string;
  plan: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
}

export const plansApi = {
  list: (all = false) =>
    call<{ entries: PlanEntry[]; pending_count: number }>(
      `/api/plans${all ? "?status=all" : ""}`
    ),
  approve: (id: number) =>
    call<{ success?: boolean; status?: string; error?: string }>(
      `/api/plans/${id}/approve`, { method: "POST", authed: true }
    ),
  reject: (id: number) =>
    call<{ success?: boolean; status?: string; error?: string }>(
      `/api/plans/${id}/reject`, { method: "POST", authed: true }
    ),
};
