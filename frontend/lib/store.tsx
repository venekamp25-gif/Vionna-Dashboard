"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export type StoreKey = "dk" | "fr";

export const STORE_CONFIG: Record<StoreKey, { label: string; language: string; currency: string }> = {
  dk: { label: "Vionna DK", language: "Danish",  currency: "DKK" },
  fr: { label: "Vionna FR", language: "French",  currency: "EUR" },
};

const StoreContext = createContext<{ store: StoreKey; setStore: (s: StoreKey) => void }>({
  store: "dk",
  setStore: () => {},
});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<StoreKey>("dk");
  return (
    <StoreContext.Provider value={{ store, setStore }}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
