"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { StoreKey } from "./store";

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
  keywords: string;
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

  // ── Active-view mirrors of contentByStore[activeViewStore] ──
  description: string;
  metaDescription: string;
  mTitleSpecs: string;
  cutline: string;

  // ── Per-store content (source of truth for tab switching) ──
  contentByStore: Record<StoreKey, StoreContent>;

  // ── Images (SHARED across stores; keyed by canonical colour) ──
  competitorImages: CompetitorImage[];
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
  selectedStores: ["dk"],
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
  contentByStore: {
    dk: { ...EMPTY_STORE_CONTENT, price: DEFAULT_PRICE_BY_STORE.dk },
    fr: { ...EMPTY_STORE_CONTENT, price: DEFAULT_PRICE_BY_STORE.fr },
  },
  competitorImages: [],
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

interface ProductContextType {
  data: ProductData;
  setData: (d: ProductData | ((prev: ProductData) => ProductData)) => void;
  patch: (partial: Partial<ProductData>) => void;
  /** Save current view edits → contentByStore[activeViewStore], load new view into mirrors. */
  switchView: (store: StoreKey) => void;
  /** Force-flush current top-level mirrors into contentByStore[activeViewStore]. */
  syncActiveView: () => void;
}

const ProductContext = createContext<ProductContextType>({
  data: DEFAULT_DATA,
  setData: () => {},
  patch: () => {},
  switchView: () => {},
  syncActiveView: () => {},
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

export function ProductProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProductData>(DEFAULT_DATA);

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
      const newView = updatedContent[newStore] ?? EMPTY_STORE_CONTENT;
      const newColors = prev.canonicalColors.map(
        (c) => newView.colorLabels[c] ?? c
      );
      return {
        ...prev,
        activeViewStore: newStore,
        contentByStore: updatedContent,
        description: newView.description,
        metaDescription: newView.metaDescription,
        mTitleSpecs: newView.mTitleSpecs,
        cutline: newView.cutline,
        // Fall back to a sensible default per-store price if the slot hasn't been
        // filled yet (e.g. first switch to FR before Generate ran).
        price: newView.price || DEFAULT_PRICE_BY_STORE[newStore] || prev.price,
        colors: newColors,
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
    <ProductContext.Provider value={{ data, setData, patch, switchView, syncActiveView }}>
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
