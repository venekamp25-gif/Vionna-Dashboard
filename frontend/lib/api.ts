/**
 * API client — talks to the Python Flask backend.
 *
 * Backend URL is configurable via NEXT_PUBLIC_BACKEND_URL env var so we can
 * point at localhost during dev and a real server (DigitalOcean droplet) in prod.
 */
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") || "http://localhost:5000";

async function call<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }
): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "include",
    signal: init?.signal,
  });
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
  error?: string;
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
  store: "dk" | "fr";
  product_name: string;
  color: string;
  product_id?: number | null;
  product_url?: string | null;
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
}

// ── Public API ──
export const api = {
  status: () => call<BackendStatus>("/api/status"),

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

  names: (store: "dk" | "fr") =>
    call<NamesResponse>("/api/names", { method: "POST", body: { store } }),

  generate: (params: {
    store: "dk" | "fr";
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

  higgsfield: (params: {
    prompt_type: number;
    product_type: string;
    image_urls: string[];
    count?: number;
    color?: string;
  }) => call<HiggsfieldResponse>("/api/higgsfield", { method: "POST", body: params }),

  publish: (params: {
    store: "dk" | "fr";
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
  }) => call<PublishResponse>("/api/publish", { method: "POST", body: params }),

  publishStartStore: (params: {
    store: "dk" | "fr";
    product_name: string;
    siblings_handle: string;
  }) => call<PublishStartStoreResponse>("/api/publish/start_store", { method: "POST", body: params }),

  backfillSalesChannels: (store: "dk" | "fr") =>
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
    }>(`/api/backfill_sales_channels?store=${store}`, { method: "POST" }),

  recentDescriptions: (params: { store: "dk" | "fr"; limit?: number }) => {
    const qs = new URLSearchParams();
    qs.set("store", params.store);
    if (params.limit) qs.set("limit", String(params.limit));
    return call<{
      store: "dk" | "fr";
      items: { title: string; handle: string; created_at: string; description: string }[];
      error?: string;
    }>(`/api/recent_descriptions?${qs.toString()}`);
  },

  history: (params?: { limit?: number; store?: "dk" | "fr"; product?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.store) qs.set("store", params.store);
    if (params?.product) qs.set("product", params.product);
    const path = "/api/history" + (qs.toString() ? `?${qs.toString()}` : "");
    return call<{ entries: HistoryEntry[]; total: number; error?: string }>(path);
  },

  publishCreateVariant: (params: {
    store: "dk" | "fr";
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
  }) => call<PublishCreateVariantResponse>("/api/publish/create_variant", { method: "POST", body: params }),
};

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
