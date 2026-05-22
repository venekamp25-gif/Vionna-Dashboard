"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { StoreKey } from "./store";
import { draftsApi, fetchCurrentUser } from "./api";

/**
 * localStorage key for the auto-saved draft. Bump the suffix when the ProductData
 * shape changes in a non-backward-compatible way so stale drafts get discarded.
 * Used as an offline fallback when server-side drafts are unreachable.
 */
const DRAFT_STORAGE_KEY = "vionna-dashboard:active-draft-v1";

export interface CompetitorInfo {
  title: string;
  hostname: string;
  variants: number;
  price: string;
}

export interface PublishResult {
  productsCreated: number;
  productUrls: string[];
  collectionUrl: string | null;
  metafieldErrors: string[];
}

export interface CompetitorImage {
  url: string;
  selected: boolean;
  /** Shopify variant IDs this image is tagged to (from competitor .json). Empty = untagged. */
  variantIds: number[];
}

export interface NbResult {
  url: string;
  selected: boolean;
  pinned?: boolean;
}

export interface PoolPhoto {
  url: string;
  label: string;
  color: string;       // "shared" for steps 1-4, CANONICAL color name for step 5
  selected: boolean;
}

/**
 * Per-store generated content. Lives inside `contentByStore[store]`.
 * `colorLabels` maps canonical English color → store-localised label.
 * `price` includes the currency suffix (e.g. "349,00 DKK" / "49,00 EUR").
 */
export interface StoreContent {
  description: string;
  metaDescription: string;
  mTitleSpecs: string;
  cutline: string;
  price: string;
  colorLabels: Record<string, string>;
}

const DEFAULT_PRICE_BY_STORE: Record<StoreKey, string> = {
  dk: "349,00 DKK",
  fr: "49,00 EUR",
};

const EMPTY_STORE_CONTENT: StoreContent = {
  description: "",
  metaDescription: "",
  mTitleSpecs: "",
  cutline: "",
  price: "",
  colorLabels: {},
};

export interface ProductData {
  // ── Input ──
  competitorUrl: string;
  /** Active-view mirror of keywordsByStore[activeViewStore]. Kept for backward
   *  compat with components that read data.keywords directly. */
  keywords: string;
  /** Per-store raw keyword text. When the user selects DK + FR at Input they
   *  fill in two separate textareas — each store's content is then generated
   *  against its OWN keywords so the Danish copy isn't seeded by French SEO
   *  research (and vice versa). */
  keywordsByStore: Record<StoreKey, string>;
  /** Stores the user wants to publish to. Picked at Input step. */
  selectedStores: StoreKey[];
  /** Which selected store's content is currently shown in the editable UI mirror. */
  activeViewStore: StoreKey;

  // ── Scraped / derived ──
  competitor: CompetitorInfo | null;

  // ── Generated / editable — SHARED across stores ──
  name: string;
  /** Canonical (English title-case) colour keys, used to key images + publishPool. */
  canonicalColors: string[];
  /** Localised labels for the ACTIVE view, derived from contentByStore[activeViewStore]. */
  colors: string[];
  sizes: string[];
  price: string;
  discount: 0 | 25 | 50;
  siblingsHandle: string;
  parsedKeywords: string[];
  /** Per-store parsed keyword arrays, mirrors keywordsByStore split on newlines. */
  parsedKeywordsByStore: Record<StoreKey, string[]>;

  // ── Active-view mirrors of contentByStore[activeViewStore] ──
  description: string;
  metaDescription: string;
  mTitleSpecs: string;
  cutline: string;

  // ── Per-store content (source of truth for tab switching) ──
  contentByStore: Record<StoreKey, StoreContent>;

  // ── Images (SHARED across stores; keyed by canonical colour) ──
  competitorImages: CompetitorImage[];
  /**
   * Canonical colour → list of competitor variant IDs for that colour.
   * Used by the per-colour ColorRefPicker to show only the relevant thumbnails.
   * Empty list (or missing key) = no per-colour filtering possible → show all.
   */
  competitorVariantsByColor: Record<string, number[]>;
  /**
   * Canonical colour → ordered list of competitor image URLs that visually
   * belong to that colour (per scrape-utils `groupImagesByColor` heuristic).
   * This is computed from the FULL scraped image set (not the 8-image cap on
   * `competitorImages` used in the ImagesCard).
   */
  competitorImagesByColor: Record<string, string[]>;
  bgReferenceUrl: string;
  productType: string;
  nbResults: Record<number, NbResult[]>;
  nbResultsPerColor: Record<string, NbResult[]>;
  colorRefsByColor: Record<string, string[]>;
  pinnedUrl: string | null;
  publishPool: PoolPhoto[];

  // ── Publish results ──
  /** Last successful publish (kept for legacy UI). */
  publishResult: PublishResult | null;
  /** Per-store publish results, populated as each store finishes. */
  publishResultsByStore: Partial<Record<StoreKey, PublishResult>>;
}

const DEFAULT_DATA: ProductData = {
  competitorUrl: "",
  keywords: "",
  keywordsByStore: { dk: "", fr: "" },
  // Default to both stores ticked — most imports go to DK + FR at the same time.
  selectedStores: ["dk", "fr"],
  activeViewStore: "dk",
  competitor: null,
  name: "",
  canonicalColors: [],
  colors: [],
  sizes: ["XS", "S", "M", "L", "XL"],
  price: "349,00 DKK",
  discount: 25,
  description: "",
  metaDescription: "",
  mTitleSpecs: "",
  cutline: "",
  siblingsHandle: "",
  parsedKeywords: [],
  parsedKeywordsByStore: { dk: [], fr: [] },
  contentByStore: {
    dk: { ...EMPTY_STORE_CONTENT, price: DEFAULT_PRICE_BY_STORE.dk },
    fr: { ...EMPTY_STORE_CONTENT, price: DEFAULT_PRICE_BY_STORE.fr },
  },
  competitorImages: [],
  competitorVariantsByColor: {},
  competitorImagesByColor: {},
  bgReferenceUrl:
    "https://rosamae.com/cdn/shop/files/rosa-mae-odette-corset-midi-dress-midi-dresses-green-4024064.png?v=1775259209&width=1200",
  productType: "dress",
  nbResults: {},
  nbResultsPerColor: {},
  colorRefsByColor: {},
  pinnedUrl: null,
  publishPool: [],
  publishResult: null,
  publishResultsByStore: {},
};

/** Where the most recent saved draft was found (or `null` if no draft). */
export type DraftSource = "server" | "local" | null;

interface ProductContextType {
  data: ProductData;
  setData: (d: ProductData | ((prev: ProductData) => ProductData)) => void;
  patch: (partial: Partial<ProductData>) => void;
  /** Save current view edits → contentByStore[activeViewStore], load new view into mirrors. */
  switchView: (store: StoreKey) => void;
  /** Force-flush current top-level mirrors into contentByStore[activeViewStore]. */
  syncActiveView: () => void;
  /** True if there's a saved draft from a previous session (set on mount). */
  hasSavedDraft: boolean;
  /** Where the discovered draft came from — informs the Resume banner copy. */
  draftSource: DraftSource;
  /** Wall-clock timestamp from the server when the draft was last saved. */
  draftSavedAt: string | null;
  /** Restore the saved draft into state. No-op if there's none. */
  restoreDraft: () => void;
  /** Discard any saved draft (called after a successful publish or explicit reset). */
  clearDraft: () => void;
}

const ProductContext = createContext<ProductContextType>({
  data: DEFAULT_DATA,
  setData: () => {},
  patch: () => {},
  switchView: () => {},
  syncActiveView: () => {},
  hasSavedDraft: false,
  draftSource: null,
  draftSavedAt: null,
  restoreDraft: () => {},
  clearDraft: () => {},
});

/** Build a StoreContent snapshot from the current top-level mirror fields. */
function snapshotActive(prev: ProductData): StoreContent {
  const colorLabels: Record<string, string> = {};
  prev.canonicalColors.forEach((canonical, i) => {
    colorLabels[canonical] = prev.colors[i] ?? canonical;
  });
  return {
    description: prev.description,
    metaDescription: prev.metaDescription,
    mTitleSpecs: prev.mTitleSpecs,
    cutline: prev.cutline,
    price: prev.price,
    colorLabels,
  };
}

/**
 * Strip server-injected internal fields and back-fill any new fields that
 * older drafts wouldn't have known about. Without this a draft saved before
 * we added e.g. `keywordsByStore` would crash on first `data.keywordsByStore[s]`
 * access.
 */
function stripInternalKeys(d: ProductData & { _saved_at?: string }): ProductData {
  const { _saved_at, ...rest } = d;
  void _saved_at;
  const merged: ProductData = {
    ...DEFAULT_DATA,
    ...(rest as ProductData),
    // Deep-merge nested per-store maps so partial drafts pick up new defaults.
    keywordsByStore: {
      ...DEFAULT_DATA.keywordsByStore,
      ...((rest as Partial<ProductData>).keywordsByStore ?? {}),
    },
    parsedKeywordsByStore: {
      ...DEFAULT_DATA.parsedKeywordsByStore,
      ...((rest as Partial<ProductData>).parsedKeywordsByStore ?? {}),
    },
    contentByStore: {
      ...DEFAULT_DATA.contentByStore,
      ...((rest as Partial<ProductData>).contentByStore ?? {}),
    },
  };

  // Migration: older drafts only had the flat `keywords` field — copy it into
  // every selected store's slot so existing in-progress drafts don't lose the
  // SEO research the user entered before this update.
  const hasAnyByStore =
    (merged.keywordsByStore.dk || "").trim().length > 0 ||
    (merged.keywordsByStore.fr || "").trim().length > 0;
  if (!hasAnyByStore && merged.keywords) {
    for (const s of merged.selectedStores) {
      merged.keywordsByStore[s] = merged.keywords;
    }
  }
  const hasAnyParsedByStore =
    (merged.parsedKeywordsByStore.dk?.length ?? 0) > 0 ||
    (merged.parsedKeywordsByStore.fr?.length ?? 0) > 0;
  if (!hasAnyParsedByStore && merged.parsedKeywords.length > 0) {
    for (const s of merged.selectedStores) {
      merged.parsedKeywordsByStore[s] = merged.parsedKeywords;
    }
  }
  return merged;
}

/** Minimum "draft is worth saving" check — only persist once the user has done meaningful work. */
function isDraftWorthSaving(d: ProductData): boolean {
  return (
    !!d.competitorUrl.trim() ||
    !!d.name.trim() ||
    d.canonicalColors.length > 0 ||
    d.publishPool.length > 0
  );
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProductData>(DEFAULT_DATA);
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [draftSource, setDraftSource] = useState<DraftSource>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const savedDraftRef = useRef<ProductData | null>(null);
  const hasMountedRef = useRef(false);
  /** Email of the currently logged-in user, populated by /api/me. Drafts on the
   *  server are keyed by this. `null` until the fetch resolves, then either a
   *  real email or the empty string when not logged in. */
  const ownerRef = useRef<string | null>(null);

  // ── On mount: figure out who we are, then load the most recent draft. ──
  // Order: server (cross-device) → localStorage (offline fallback).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    (async () => {
      // 1. Get current user — runs even when offline; just returns null.
      let owner = "";
      try {
        const me = await fetchCurrentUser();
        owner = (me.email ?? "").trim();
      } catch {
        // ignore — fall through to localStorage
      }
      if (cancelled) return;
      ownerRef.current = owner;

      // 2. Try server draft first (only if we know who we are).
      if (owner) {
        try {
          const r = await draftsApi.load<ProductData>(owner);
          if (cancelled) return;
          const serverDraft = r.draft;
          if (serverDraft && isDraftWorthSaving(serverDraft)) {
            savedDraftRef.current = stripInternalKeys(serverDraft);
            setDraftSource("server");
            setDraftSavedAt(r.saved_at ?? serverDraft._saved_at ?? null);
            setHasSavedDraft(true);
            hasMountedRef.current = true;
            return;
          }
        } catch {
          // Server unreachable — drop to localStorage
        }
      }

      // 3. Fallback: localStorage.
      try {
        const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ProductData;
          if (isDraftWorthSaving(parsed)) {
            savedDraftRef.current = parsed;
            setDraftSource("local");
            setHasSavedDraft(true);
          }
        }
      } catch {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
      hasMountedRef.current = true;
    })();

    return () => { cancelled = true; };
  }, []);

  // ── Auto-save to localStorage on every change (debounced 500ms) — fast cache. ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasMountedRef.current) return;
    const id = setTimeout(() => {
      try {
        if (isDraftWorthSaving(data)) {
          window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(data));
        } else {
          window.localStorage.removeItem(DRAFT_STORAGE_KEY);
        }
      } catch {
        // Quota exceeded — skip
      }
    }, 500);
    return () => clearTimeout(id);
  }, [data]);

  // ── Auto-save to server (debounced 1s) — cross-device persistence. ──
  //
  // CRITICAL: don't auto-save while the Resume-this-draft banner is still
  // visible. Otherwise: user lands on Input, sees the banner, but starts
  // typing a new URL without clicking Resume → auto-save fires with the new
  // (mostly empty) data → server's old photo-filled draft is overwritten and
  // the photos are gone forever. The user must explicitly Resume or Discard
  // first; until they do, the server draft is locked.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasMountedRef.current) return;
    if (hasSavedDraft) return;  // ← banner still open — don't clobber
    const owner = ownerRef.current;
    if (!owner) return;
    if (!isDraftWorthSaving(data)) return;
    const id = setTimeout(() => {
      draftsApi
        .save(owner, data)
        .catch(() => {
          // Network issues — localStorage already has the data
        });
    }, 1000);
    return () => clearTimeout(id);
  }, [data, hasSavedDraft]);

  // ── Last-chance flush when the page is about to unload ──
  // navigator.sendBeacon survives tab-close where regular fetch would be aborted.
  // It uses a fire-and-forget POST so we don't need to wait for a response.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      const owner = ownerRef.current;
      if (!owner) return;
      if (hasSavedDraft) return;  // banner still open — don't clobber server draft
      if (!isDraftWorthSaving(data)) return;
      try {
        const url =
          (process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") ||
            "http://localhost:5000") +
          `/api/drafts?owner=${encodeURIComponent(owner)}`;
        const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      } catch {
        // Best effort; localStorage still has the data anyway.
      }
    };
    // pagehide fires both on unload AND on bfcache (back/forward cache); more
    // reliable than beforeunload across browsers.
    window.addEventListener("pagehide", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      window.removeEventListener("beforeunload", handler);
    };
  }, [data, hasSavedDraft]);

  const restoreDraft = useCallback(() => {
    if (savedDraftRef.current) {
      setData(savedDraftRef.current);
      setHasSavedDraft(false);
    }
  }, []);

  const clearDraft = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
    savedDraftRef.current = null;
    setHasSavedDraft(false);
    setDraftSource(null);
    setDraftSavedAt(null);
    const owner = ownerRef.current;
    if (owner) {
      void draftsApi.clear(owner);
    }
  }, []);

  const patch = useCallback(
    (partial: Partial<ProductData>) =>
      setData((prev) => ({ ...prev, ...partial })),
    []
  );

  const switchView = useCallback((newStore: StoreKey) => {
    setData((prev) => {
      if (prev.activeViewStore === newStore) return prev;
      const saved = snapshotActive(prev);
      const updatedContent = {
        ...prev.contentByStore,
        [prev.activeViewStore]: saved,
      };
      // Persist the active view's keyword mirrors back to the per-store map
      // so a tab switch never loses keyword edits.
      const updatedKeywordsByStore = {
        ...prev.keywordsByStore,
        [prev.activeViewStore]: prev.keywords,
      };
      const updatedParsedKeywordsByStore = {
        ...prev.parsedKeywordsByStore,
        [prev.activeViewStore]: prev.parsedKeywords,
      };
      const newView = updatedContent[newStore] ?? EMPTY_STORE_CONTENT;
      const newColors = prev.canonicalColors.map(
        (c) => newView.colorLabels[c] ?? c
      );
      return {
        ...prev,
        activeViewStore: newStore,
        contentByStore: updatedContent,
        keywordsByStore: updatedKeywordsByStore,
        parsedKeywordsByStore: updatedParsedKeywordsByStore,
        description: newView.description,
        metaDescription: newView.metaDescription,
        mTitleSpecs: newView.mTitleSpecs,
        cutline: newView.cutline,
        // Fall back to a sensible default per-store price if the slot hasn't been
        // filled yet (e.g. first switch to FR before Generate ran).
        price: newView.price || DEFAULT_PRICE_BY_STORE[newStore] || prev.price,
        colors: newColors,
        // Load the new store's keywords into the active-view mirror
        keywords: updatedKeywordsByStore[newStore] ?? "",
        parsedKeywords: updatedParsedKeywordsByStore[newStore] ?? [],
      };
    });
  }, []);

  const syncActiveView = useCallback(() => {
    setData((prev) => ({
      ...prev,
      contentByStore: {
        ...prev.contentByStore,
        [prev.activeViewStore]: snapshotActive(prev),
      },
    }));
  }, []);

  return (
    <ProductContext.Provider value={{
      data, setData, patch, switchView, syncActiveView,
      hasSavedDraft, draftSource, draftSavedAt, restoreDraft, clearDraft,
    }}>
      {children}
    </ProductContext.Provider>
  );
}

export const useProduct = () => useContext(ProductContext);

/** Look up the localised display label for a canonical colour in a given store. */
export function colorLabelFor(
  data: ProductData,
  canonical: string,
  store: StoreKey
): string {
  return data.contentByStore[store]?.colorLabels?.[canonical] ?? canonical;
}
