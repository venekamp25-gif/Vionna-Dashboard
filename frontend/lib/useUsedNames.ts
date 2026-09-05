"use client";

import { useEffect, useState } from "react";
import { useProduct } from "./product";
import { StoreKey } from "./store";
import { api } from "./api";
import { slugName } from "./publishChecks";

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
  const [byStore, setByStore] = useState<Record<StoreKey, string[]>>({ dk: [], fr: [], fi: [] });
  // Winkels waarvan de lijst NIET geladen kon worden. Voorheen werd een fout
  // stilzwijgend een lege lijst -- en "leeg" leest als "geen namen in gebruik".
  const [unavailable, setUnavailable] = useState<StoreKey[]>([]);
  const [loading, setLoading] = useState(true);

  const key = data.selectedStores.join(",");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      data.selectedStores.map(async (s): Promise<[StoreKey, string[] | null]> => {
        try {
          const r = await api.names(s);
          // Een afgekapte lijst (>2500 producten) is ook onvolledig.
          if (r.error || r.complete === false) return [s, null];
          return [s, r.names ?? []];
        } catch {
          return [s, null];
        }
      })
    )
      .then((pairs) => {
        if (cancelled) return;
        const next: Record<StoreKey, string[]> = { dk: [], fr: [], fi: [] };
        const failed: StoreKey[] = [];
        for (const [s, names] of pairs) {
          if (names === null) failed.push(s);
          else next[s] = names;
        }
        setByStore(next);
        setUnavailable(failed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const takenLower = new Set<string>();
  const takenSlugs = new Set<string>();
  for (const s of data.selectedStores) {
    for (const n of byStore[s] ?? []) {
      takenLower.add(n.toLowerCase());
      takenSlugs.add(slugName(n));
    }
  }

  return { byStore, takenLower, takenSlugs, unavailable, loading };
}
