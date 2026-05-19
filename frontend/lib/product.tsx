"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface ProductInput {
  competitorUrl: string;
  keywords: string;
}

interface ProductContextType {
  input: ProductInput;
  setInput: (i: ProductInput | ((prev: ProductInput) => ProductInput)) => void;
}

const ProductContext = createContext<ProductContextType>({
  input: { competitorUrl: "", keywords: "" },
  setInput: () => {},
});

export function ProductProvider({ children }: { children: ReactNode }) {
  const [input, setInput] = useState<ProductInput>({
    competitorUrl: "",
    keywords: "",
  });
  return (
    <ProductContext.Provider value={{ input, setInput }}>
      {children}
    </ProductContext.Provider>
  );
}

export const useProduct = () => useContext(ProductContext);
