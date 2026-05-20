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
  description: string;
  meta_description: string;
  m_title_specs: string;
  error?: string;
}

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

// ── Public API ──
export const api = {
  status: () => call<BackendStatus>("/api/status"),

  scrape: (url: string) =>
    call<ScrapedProduct>("/api/scrape", { method: "POST", body: { url } }),

  names: (store: "dk" | "fr") =>
    call<NamesResponse>("/api/names", { method: "POST", body: { store } }),

  generate: (params: {
    store: "dk" | "fr";
    product_name: string;
    product_title: string;
    keywords: string[];
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
};

export const BACKEND = BACKEND_URL;
