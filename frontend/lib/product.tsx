"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export interface CompetitorInfo {
  title: string;
  hostname: string;
  variants: number;
  price: string;
}

export interface ProductData {
  // Input
  competitorUrl: string;
  keywords: string;        // raw textarea content
  // Scraped / derived
  competitor: CompetitorInfo | null;
  // Generated / editable
  name: string;
  colors: string[];
  sizes: string[];
  price: string;          // e.g. "349,00 DKK"
  discount: 0 | 25 | 50;
  description: string;
  metaDescription: string;
  mTitleSpecs: string;
  cutline: string;
  siblingsHandle: string;
  parsedKeywords: string[];
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
  const patch = (partial: Partial<ProductData>) =>
    setData((prev) => ({ ...prev, ...partial }));
  return (
    <ProductContext.Provider value={{ data, setData, patch }}>
      {children}
    </ProductContext.Provider>
  );
}

export const useProduct = () => useContext(ProductContext);
