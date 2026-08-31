/**
 * Per-store grouping and sorting for the margin watch, kept free of React so it
 * can be unit-tested directly (`npm test` in frontend/).
 *
 * Why per-store matters here and is not just cosmetic: the amounts are in the
 * store's own currency. DK is in DKK, every other store in EUR, so a single
 * mixed table invites comparing 349,95 DKK against 49,95 EUR as if they were
 * the same scale. The percentage is the only figure that compares across
 * stores; the money columns only mean something within one.
 */

/** Structural subset of CogsProduct (lib/api.ts) — only what grouping needs. */
export interface StoreRow {
  store: string;
  currency?: string | null;
  over?: boolean;
  estimated?: boolean;
  pct: number;
  cost: number;
  price: number;
  seen?: number;
  title?: string;
  shopify_title?: string;
}

/**
 * Display names for the store keys the report emits. Vionna is one brand per
 * market, The Light Supplier another. An unknown key is shown as-is rather than
 * hidden: a new store must never disappear from the tab just because nobody
 * added it here.
 */
const STORE_LABELS: Record<string, string> = {
  dk: "Vionna DK",
  fr: "Vionna FR",
  fi: "Vionna FI",
  nl: "Light Supplier NL",
  de: "Light Supplier DE",
};

export function storeLabel(key: string): string {
  return STORE_LABELS[key] ?? key.toUpperCase();
}

export interface StoreSummary {
  store: string;
  label: string;
  /** Products with a cost we could judge. */
  total: number;
  /** Products over the 40% threshold. */
  over: number;
  /** The store's currency, or null when nothing was judged for it. */
  currency: string | null;
  /** Every figure for this store is derived from the Finnish quote. */
  allEstimated: boolean;
  /** A real supplier quote was found for this store at least once. */
  hasMeasuredCost: boolean;
  /** More than one currency turned up — should not happen; surfaced, not hidden. */
  mixedCurrency: boolean;
}

/**
 * One entry per store, worst first.
 *
 * `storesWithCosts` comes from the report and lists the stores a real quote was
 * found for. A store that appears there but has no products to show is still
 * given a row: "nothing to report" and "we could not read this store" must not
 * look the same.
 */
export function storeSummaries(
  rows: StoreRow[],
  storesWithCosts: string[] = []
): StoreSummary[] {
  const byStore = new Map<string, StoreRow[]>();
  for (const r of rows) {
    const list = byStore.get(r.store);
    if (list) list.push(r);
    else byStore.set(r.store, [r]);
  }
  for (const s of storesWithCosts) {
    if (!byStore.has(s)) byStore.set(s, []);
  }

  const out: StoreSummary[] = [];
  for (const [store, list] of byStore) {
    const currencies = new Set(
      list.map((r) => r.currency).filter((c): c is string => !!c)
    );
    out.push({
      store,
      label: storeLabel(store),
      total: list.length,
      over: list.filter((r) => r.over).length,
      currency: currencies.size === 1 ? [...currencies][0] : null,
      allEstimated: list.length > 0 && list.every((r) => r.estimated),
      hasMeasuredCost: storesWithCosts.includes(store),
      mixedCurrency: currencies.size > 1,
    });
  }
  // Most products over the threshold first — that is where the money is. Ties
  // fall back to the store with the most judged products, then to the name so
  // the order never wobbles between renders.
  out.sort(
    (a, b) => b.over - a.over || b.total - a.total || a.store.localeCompare(b.store)
  );
  return out;
}

export type SortKey = "pct" | "cost" | "price" | "seen" | "title" | "store";
export type SortDir = "asc" | "desc";

/**
 * Sort a product list. Money columns are only meaningful within one store, so
 * sorting on them across stores is allowed but the UI warns; the percentage is
 * always comparable.
 */
export function sortProducts<T extends StoreRow>(
  rows: T[],
  key: SortKey,
  dir: SortDir
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const name = (r: StoreRow) => (r.shopify_title || r.title || "").toLowerCase();
  const copy = [...rows];
  copy.sort((a, b) => {
    let d = 0;
    switch (key) {
      case "title":
        d = name(a).localeCompare(name(b));
        break;
      case "store":
        d = storeLabel(a.store).localeCompare(storeLabel(b.store));
        break;
      case "seen":
        d = (a.seen ?? 0) - (b.seen ?? 0);
        break;
      default:
        d = (a[key] ?? 0) - (b[key] ?? 0);
    }
    // Stable tiebreak, otherwise equal percentages reshuffle on every re-render.
    return d * sign || name(a).localeCompare(name(b));
  });
  return copy;
}
