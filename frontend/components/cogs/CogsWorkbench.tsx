"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, CogsOverview, CogsProduct } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import {
  SortDir,
  SortKey,
  sortProducts,
  storeLabel,
  storeSummaries,
} from "@/lib/cogsStores";

/** A column header you can click to sort on. The arrow shows the direction, so
 *  the operator can always see WHY the list is in this order. */
function Th({
  children,
  col,
  sort,
  onSort,
  align = "right",
}: {
  children: React.ReactNode;
  col: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const activeCol = sort.key === col;
  return (
    <th
      className={`font-medium px-3 py-2 ${align === "left" ? "text-left" : "text-right"}`}
      aria-sort={activeCol ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`hover:text-text transition-colors ${activeCol ? "text-text" : ""}`}
      >
        {children}
        <span className="ml-1 text-[10px]">
          {activeCol ? (sort.dir === "asc" ? "▲" : "▼") : "·"}
        </span>
      </button>
    </th>
  );
}

/** Margin watch: which products have a supplier cost eating too much of the
 *  selling price, and what price would bring them back to 30-40%.
 *
 *  Store-agnostic on purpose — it sits outside /fashion and /home-decor so it
 *  covers every store in one place, the way the research workbench does.
 *
 *  WARN, NEVER BLOCK: a suggestion is pre-filled but always editable, and
 *  nothing is written until the operator presses Apply on that row. */
export function CogsWorkbench() {
  const [data, setData] = useState<CogsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  // GEMETEN 2026-08-26: scope=weekly (120 dagen) laat de worker van
  // master-dashboard omvallen -- drie keer herhaald, elke keer HTTP 500 na
  // ~30s, en na een paar pogingen lag de HELE service er even uit (dus ook
  // P&L en Klaviyo). Daarom opent de tab op de lichte scope; weekly blijft
  // kiesbaar maar is als zwaar gemarkeerd tot de bron het aankan.
  const [scope, setScope] = useState<"daily" | "weekly">("daily");
  const [onlyOver, setOnlyOver] = useState(true);
  // "" = alle winkels. De keuze blijft staan als de scope verandert,
  // zolang de winkel dan nog bestaat (zie de useEffect hieronder).
  const [store, setStore] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "pct",
    dir: "desc",
  });
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (s: "daily" | "weekly") => {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.cogsOverview(s));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [scope, load]);

  const products = useMemo(() => data?.products ?? [], [data]);

  // Een tab per winkel, met de winkels die WEL een inkoopprijs opleverden maar
  // geen producten -- anders leest "niets te melden" hetzelfde als "deze winkel
  // is niet gelezen".
  const stores = useMemo(
    () => storeSummaries(products, data?.stores_with_costs ?? []),
    [products, data]
  );

  // Verdwijnt de gekozen winkel na een scope-wissel, val dan terug op alle
  // winkels in plaats van een lege tabel te tonen die er gezond uitziet.
  useEffect(() => {
    if (store && !stores.some((s) => s.store === store)) setStore("");
  }, [stores, store]);

  const active = stores.find((s) => s.store === store) ?? null;

  // PRODUCTEN, niet varianten: acht maten van dezelfde jurk is een besluit.
  const rows = useMemo(() => {
    let all = products;
    if (store) all = all.filter((r) => r.store === store);
    if (onlyOver) all = all.filter((r) => r.over);
    return sortProducts(all, sort.key, sort.dir);
  }, [products, store, onlyOver, sort]);

  // Bedragen uit verschillende valuta's naast elkaar zijn niet te vergelijken.
  const mixedCurrency = useMemo(() => {
    const cur = new Set(rows.map((r) => r.currency).filter(Boolean));
    return cur.size > 1;
  }, [rows]);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
        : // Namen lezen van A naar Z, cijfers met de ergste bovenaan.
          { key, dir: key === "title" || key === "store" ? "asc" : "desc" }
    );

  const keyOf = (r: CogsProduct) => `${r.store}:${r.product_id ?? r.title}`;

  const money = (v: number | null | undefined, cur?: string | null) =>
    v == null
      ? "—"
      : `${v.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ""}`;

  /** Ratio the row WOULD have at the price currently typed in the box, so the
   *  operator sees the effect of their own number, not only of my suggestion. */
  const previewPct = (r: CogsProduct) => {
    const raw = edited[keyOf(r)];
    const p = raw ? Number(raw.replace(",", ".")) : r.suggested_price ?? null;
    if (!p || p <= 0) return null;
    const basis = r.vat ? p / (1 + r.vat) : p;
    return (r.cost / basis) * 100;
  };

  const apply = async (r: CogsProduct) => {
    const k = keyOf(r);
    const raw = edited[k] ?? String(r.suggested_price ?? "");
    const price = Number(raw.replace(",", "."));
    if (!price || price <= 0) {
      setDone((d) => ({ ...d, [k]: "enter a price first" }));
      return;
    }
    // Keep the struck-through price in step: raising only `price` shrinks the
    // discount or makes the badge vanish. Scale it by the same factor.
    let compareAt: number | undefined;
    if (r.compare_at && r.compare_at > r.price) {
      compareAt =
        r.suggested_price && price === r.suggested_price && r.suggested_compare_at
          ? r.suggested_compare_at
          : Math.ceil((r.compare_at / r.price) * price);
    }
    setBusy((b) => ({ ...b, [k]: true }));
    setDone((d) => ({ ...d, [k]: "" }));
    try {
      // Elke maat krijgt dezelfde prijs — dat is hoe het assortiment is opgezet.
      const res = await api.pricingApply(
        r.store,
        r.variants.map((v) => ({
          variant_id: v.variant_id,
          price,
          compare_at_price: compareAt,
        }))
      );
      setDone((d) => ({
        ...d,
        [k]:
          res.updated > 0
            ? `✓ ${res.updated}/${r.variants.length} sizes now ${money(price, r.currency)}` +
              (res.failed ? ` — ${res.failed} failed` : "")
            : `✕ ${res.errors?.[0]?.error ?? "failed"}`,
      }));
    } catch (e) {
      setDone((d) => ({ ...d, [k]: `✕ ${e instanceof Error ? e.message : "failed"}` }));
    } finally {
      setBusy((b) => ({ ...b, [k]: false }));
    }
  };

  const alertCount = (store ? products.filter((r) => r.store === store) : products)
    .filter((r) => r.over).length;

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="sticky top-0 z-10 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center gap-4">
          <Link href="/" className="text-[13px] text-accent hover:underline whitespace-nowrap">
            ← Dashboard
          </Link>
          <div className="flex-1">
            <h1 className="text-[15px] font-semibold">Margin watch</h1>
            <p className="text-[11.5px] text-text-dim">
              {active
                ? `Supplier cost versus the current selling price — ${active.label}.`
                : "Supplier cost versus the current selling price, across every store."}
            </p>
          </div>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "daily" | "weekly")}
            className="text-[12px] bg-surface border border-border rounded px-2 py-1"
          >
            <option value="daily">Just sold (5 days)</option>
            <option value="weekly">All recently sold (120 days) — heavy</option>
          </select>
          <Button variant="secondary" onClick={() => void load(scope)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 py-5">
        {err && (
          <p className="text-[12.5px] rounded-md border border-danger/40 bg-danger/10 text-danger px-3 py-2 mb-4">
            {err}
          </p>
        )}

        {/* A link that isn't set up must never look like "nothing to report". */}
        {data && data.configured === false && (
          <p className="text-[12.5px] rounded-md border border-warning/40 bg-warning/10 px-3 py-2 mb-4">
            <strong>Not connected yet.</strong> {data.error} — until then this page
            cannot tell you whether any product is over the threshold.
          </p>
        )}
        {data?.error && data.configured !== false && (
          <p className="text-[12.5px] rounded-md border border-danger/40 bg-danger/10 text-danger px-3 py-2 mb-4">
            <strong>Could not read the source:</strong> {data.error}
            {data.detail ? ` — ${data.detail}` : ""}
          </p>
        )}

        {/* Een tab per winkel. De bedragen staan in de valuta van de winkel, dus
            per winkel kijken is hier de normale manier van werken -- niet een
            extra filter bovenop een gemengde lijst. */}
        {data && !data.error && stores.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={store === ""}
              onClick={() => setStore("")}
              className={`text-[12px] rounded-md px-2.5 py-1 border transition-colors ${
                store === ""
                  ? "border-accent bg-accent/10 text-text font-medium"
                  : "border-border text-text-dim hover:text-text"
              }`}
            >
              All stores
              <span className="ml-1.5 text-[11px] text-text-dim">
                {products.filter((r) => r.over).length}/{products.length}
              </span>
            </button>
            {stores.map((s) => (
              <button
                key={s.store}
                type="button"
                role="tab"
                aria-selected={store === s.store}
                onClick={() => setStore(s.store)}
                className={`text-[12px] rounded-md px-2.5 py-1 border transition-colors ${
                  store === s.store
                    ? "border-accent bg-accent/10 text-text font-medium"
                    : "border-border text-text-dim hover:text-text"
                }`}
              >
                {s.label}
                <span
                  className={`ml-1.5 text-[11px] ${
                    s.over > 0 ? "text-danger" : "text-text-dim"
                  }`}
                >
                  {s.over}/{s.total}
                </span>
                {s.allEstimated && (
                  <span
                    className="ml-1 text-[10px] text-warning"
                    title="Every figure for this store is derived from the Finnish quote for the same product."
                  >
                    ~
                  </span>
                )}
                {s.total === 0 && (
                  <span
                    className="ml-1 text-[10px] text-warning"
                    title="A supplier quote came in for this store, but no product could be judged — check rather than assume it is fine."
                  >
                    !
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Silence is not approval: een winkel die wel een inkoopprijs opleverde
            maar geen enkel beoordeeld product moet dat zelf zeggen. */}
        {active && active.total === 0 && (
          <p className="text-[12.5px] rounded-md border border-warning/40 bg-warning/10 px-3 py-2 mb-4">
            <strong>{active.label} produced no judgeable product.</strong> A
            supplier quote did come in for this store, so this is not the same as
            &quot;nothing is over the threshold&quot; — the current selling price
            could not be matched. Worth a look before you treat it as fine.
          </p>
        )}

        {data && !data.error && (
          <div className="flex flex-wrap items-center gap-4 mb-4 text-[12px] text-text-dim">
            <span>
              <strong className="text-text">{alertCount}</strong> over 40%
              {active ? ` in ${active.label}` : ""}
            </span>
            <span>
              {data.counted ?? 0} variant(s) with a known cost
            </span>
            {(data.estimated_rows ?? 0) > 0 && (
              <span title="DK/FR run through Fillbox, which reports no per-product cost. These use the Finnish quote for the same product — an estimate, not a measurement.">
                {data.estimated_rows} estimated from FI
              </span>
            )}
            {(data.unknown_count ?? 0) > 0 && (
              <span title="Sold, but we could not read a current price for them">
                {data.unknown_count} not judged
              </span>
            )}
            {data.stats?.geen_toewijsbare_quote ? (
              <span title="Orders with several items where the supplier cost could not be attributed to one product — skipped rather than guessed">
                {data.stats.geen_toewijsbare_quote} order line(s) without an
                attributable cost
              </span>
            ) : null}
            <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
              <input
                type="checkbox"
                checked={onlyOver}
                onChange={(e) => setOnlyOver(e.target.checked)}
                className="accent-accent"
              />
              Only show products over 40%
            </label>
          </div>
        )}

        {mixedCurrency && (
          <p className="text-[11.5px] text-text-dim mb-3">
            This view mixes currencies ({[...new Set(rows.map((r) => r.currency).filter(Boolean))].join(", ")}),
            so the money columns are not comparable between rows — only the COGS
            percentage is. Pick a store above to compare amounts.
          </p>
        )}

        {Object.keys(data?.price_errors ?? {}).length > 0 && (
          <p className="text-[11.5px] text-text-dim mb-3">
            Could not read prices for:{" "}
            {Object.entries(data!.price_errors!)
              .map(([s, e]) => `${s.toUpperCase()} (${e})`)
              .join(", ")}
          </p>
        )}

        {loading && !data ? (
          <p className="text-[12.5px] text-text-faint">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[12.5px] text-text-faint">
            {data && !data.error
              ? onlyOver
                ? `No product is over 40% right now${active ? ` in ${active.label}` : ""}.`
                : `Nothing with a known cost in this window${active ? ` for ${active.label}` : ""}.`
              : ""}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[12.5px]">
              <thead className="bg-surface text-text-dim">
                <tr>
                  <Th sort={sort} onSort={toggleSort} col="title" align="left">
                    Product
                  </Th>
                  {!store && (
                    <Th sort={sort} onSort={toggleSort} col="store" align="left">
                      Store
                    </Th>
                  )}
                  <Th sort={sort} onSort={toggleSort} col="cost">
                    Cost
                  </Th>
                  <Th sort={sort} onSort={toggleSort} col="price">
                    Price
                  </Th>
                  <Th sort={sort} onSort={toggleSort} col="pct">
                    COGS
                  </Th>
                  <th className="text-right font-medium px-3 py-2">New price</th>
                  <th className="text-right font-medium px-3 py-2">Becomes</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const k = keyOf(r);
                  const preview = previewPct(r);
                  const value = edited[k] ?? (r.suggested_price ?? "").toString();
                  return (
                    <tr key={k} className="border-t border-border align-middle">
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {r.shopify_title || r.title}
                        </div>
                        <div className="text-[11px] text-text-dim">
                          {r.variant_count > 1 ? `${r.variant_count} sizes` : ""}
                          {r.variant_count > 1 && r.seen ? " · " : ""}
                          {r.seen ? `${r.seen}× sold` : ""}
                          {r.estimated && (
                            <span
                              className="ml-1.5 px-1.5 py-0.5 rounded bg-warning/20 text-warning font-medium"
                              title={r.estimate_basis ?? "Derived from the Finnish quote for the same product"}
                            >
                              estimated
                            </span>
                          )}
                        </div>
                      </td>
                      {!store && (
                        <td className="px-3 py-2 whitespace-nowrap text-text-dim">
                          {storeLabel(r.store)}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {money(r.cost, r.currency)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {money(r.price, r.currency)}
                        {r.price_varies && (
                          <span
                            className="text-[10.5px] text-text-dim"
                            title={`Sizes range up to ${money(r.price_max, r.currency)}. We judge the lowest price — that is the tightest margin.`}
                          >
                            {" "}–{money(r.price_max, r.currency)}
                          </span>
                        )}
                        {r.compare_at ? (
                          <div className="text-[10.5px] text-text-dim line-through">
                            {money(r.compare_at, r.currency)}
                          </div>
                        ) : null}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${
                          r.over ? "text-danger" : "text-text"
                        }`}
                      >
                        {r.pct.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          value={value}
                          onChange={(e) =>
                            setEdited((s) => ({ ...s, [k]: e.target.value }))
                          }
                          inputMode="decimal"
                          placeholder="—"
                          className="w-24 text-right bg-surface border border-border rounded px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-text-dim">
                        {preview != null
                          ? `${preview.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button
                          variant="secondary"
                          onClick={() => void apply(r)}
                          disabled={!!busy[k]}
                        >
                          {busy[k] ? "Saving…" : "Apply"}
                        </Button>
                        {done[k] && (
                          <div
                            className={`text-[10.5px] mt-1 ${
                              done[k].startsWith("✓") ? "text-text-dim" : "text-danger"
                            }`}
                          >
                            {done[k]}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-text-faint mt-4 max-w-3xl">
          Cost comes from the accepted supplier quote in ServicePoints, matched to
          the exact Shopify variant. Rows marked <em>estimated</em> are Vionna
          DK/FR: those run through Fillbox, which reports no per-product cost, so
          they borrow the Finnish quote for the same product (converted to DKK
          where needed). Treat those as an indication, not a measurement. Percentages are on the gross price (no VAT is
          remitted). Products that have never sold have no quote, so they cannot
          appear here. Raising a price also raises the struck-through was-price by
          the same factor, so the discount stays intact.
        </p>
      </div>
    </div>
  );
}
