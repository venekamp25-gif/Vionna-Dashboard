"use client";

import { useEffect, useState } from "react";
import { useProduct } from "./product";
import { StoreKey } from "./store";
import { api } from "./api";

/**
 * Fetch product names already used across every selected Shopify store.
 *
 * Exposes:
 *   - `byStore`     — Record<StoreKey, string[]> (per-store catalogue list)
 *   - `takenLower`  — flat Set<string> of every name (lowercased), union across stores.
 *   - `loading`     — true until the first fetch completes
 *
 * The fetch re-runs only when the SET of selected stores changes (we key off
 * the join, so React doesn't re-fetch on every render).
 */
export function useUsedNames() {
  const { data } = useProduct();
  const [byStore, setByStore] = useState<Record<StoreKey, string[]>>({ dk: [], fr: [] });
  const [loading, setLoading] = useState(true);

  const key = data.selectedStores.join(",");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      data.selectedStores.map(async (s): Promise<[StoreKey, string[]]> => {
        try {
          const r = await api.names(s);
          return [s, r.names ?? []];
        } catch {
          return [s, []];
        }
      })
    )
      .then((pairs) => {
        if (cancelled) return;
        const next: Record<StoreKey, string[]> = { dk: [], fr: [] };
        for (const [s, names] of pairs) next[s] = names;
        setByStore(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const takenLower = new Set<string>();
  for (const s of data.selectedStores) {
    for (const n of byStore[s] ?? []) takenLower.add(n.toLowerCase());
  }

  return { byStore, takenLower, loading };
}
