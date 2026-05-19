"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

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
  color: string;       // "shared" for steps 1-4, color name for step 5
  selected: boolean;
}

export interface ProductData {
  // Input
  competitorUrl: string;
  keywords: string;
  // Scraped / derived
  competitor: CompetitorInfo | null;
  // Generated / editable
  name: string;
  colors: string[];
  sizes: string[];
  price: string;
  discount: 0 | 25 | 50;
  description: string;
  metaDescription: string;
  mTitleSpecs: string;
  cutline: string;
  siblingsHandle: string;
  parsedKeywords: string[];
  // Images
  competitorImages: CompetitorImage[];
  bgReferenceUrl: string;
  productType: string;
  nbResults: Record<number, NbResult[]>;   // step number → results array
  nbResultsPerColor: Record<string, NbResult[]>; // color name → results (step 5)
  pinnedUrl: string | null;                // model reference pinned across NB steps
  publishPool: PoolPhoto[];
  publishResult: PublishResult | null;     // filled after successful Shopify publish
}

const DEFAULT_DATA: ProductData = {
  competitorUrl: "",
  keywords: "",
  competitor: null,
  name: "",
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
  competitorImages: [],
  bgReferenceUrl:
    "https://rosamae.com/cdn/shop/files/rosa-mae-odette-corset-midi-dress-midi-dresses-green-4024064.png?v=1775259209&width=1200",
  productType: "dress",
  nbResults: {},
  nbResultsPerColor: {},
  pinnedUrl: null,
  publishPool: [],
  publishResult: null,
};

interface ProductContextType {
  data: ProductData;
  setData: (d: ProductData | ((prev: ProductData) => ProductData)) => void;
  patch: (partial: Partial<ProductData>) => void;
}

const ProductContext = createContext<ProductContextType>({
  data: DEFAULT_DATA,
  setData: () => {},
  patch: () => {},
});

export function ProductProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProductData>(DEFAULT_DATA);
  const patch = useCallback(
    (partial: Partial<ProductData>) =>
      setData((prev) => ({ ...prev, ...partial })),
    []
  );
  return (
    <ProductContext.Provider value={{ data, setData, patch }}>
      {children}
    </ProductContext.Provider>
  );
}

export const useProduct = () => useContext(ProductContext);
