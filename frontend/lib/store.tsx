"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export type StoreKey = "dk" | "fr" | "fi";

export const STORE_CONFIG: Record<StoreKey, { label: string; language: string; currency: string }> = {
  dk: { label: "Store DK", language: "Danish",  currency: "DKK" },
  fr: { label: "Store FR", language: "French",  currency: "EUR" },
  fi: { label: "Store FI", language: "Finnish", currency: "EUR" },
};

// Canonical store order — import this everywhere instead of hardcoding ["dk","fr"].
// Adding a store here + to STORE_CONFIG + to the colour maps is most of the work.
export const STORE_KEYS: StoreKey[] = ["dk", "fr", "fi"];

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
