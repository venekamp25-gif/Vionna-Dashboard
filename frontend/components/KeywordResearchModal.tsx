"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { StoreKey, STORE_CONFIG, STORE_KEYS } from "@/lib/store";
import { Button } from "@/components/ui/Button";

type Kw = NonNullable<Awaited<ReturnType<typeof api.keywordResearchNiche>>["keywords"]>[number];

function seasonText(k: Kw): string {
  const s = k.seasonality;
  if (s?.seasonal && s.peak_month) return `peak ${s.peak_month} → push ${s.push_from_month}`;
  if (s?.trend && s.trend !== "flat") return s.trend === "rising" ? "↑ rising" : "↓ falling";
  return "—";
}

/**
 * Standalone keyword research (the DSA product-research strategy, automated):
 * enter a product type + pick a market → trending, high-volume keywords for that
 * type with monthly search volume + seasonality.
 */
export function KeywordResearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [store, setStore] = useState<StoreKey>("dk");
  const [productType, setProductType] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { store: StoreKey; type: string; seeds: string[]; found: number; minVolume: number; keywords: Kw[] } | null
  >(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun = productType.trim().length > 0 && !busy;

  const run = async () => {
    if (!productType.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setNotConfigured(false);
    try {
      const r = await api.keywordResearchNiche({ store, product_type: productType.trim() });
      if (!r.configured) {
        setNotConfigured(true);
        return;
      }
      setResult({
        store,
        type: r.product_type ?? productType.trim(),
        seeds: r.seeds ?? [],
        found: r.found ?? 0,
        minVolume: r.min_volume ?? 0,
        keywords: r.keywords ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setBusy(false);
    }
  };

  const copyAll = () => {
    if (!result) return;
    void navigator.clipboard?.writeText(result.keywords.map((k) => k.keyword).join("\n"));
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-elev border border-border rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-[16px] font-semibold text-text">Keyword research</h2>
            <p className="text-[12px] text-text-faint mt-0.5">
              Trending, high-volume keywords for one product type per market — with search volume and seasonality.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-text text-xl leading-none">
            ×
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 py-4 border-b border-border shrink-0 space-y-3">
          <div>
            <label className="block text-[11px] font-medium tracking-wide uppercase text-text-faint mb-1.5">
              Product type
            </label>
            <input
              type="text"
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canRun) void run();
              }}
              placeholder="e.g. dress, jacket, cardigan, boots, bag…"
              autoFocus
              className="w-full px-3 h-10 rounded-[10px] bg-bg-elev-2 border border-border text-[13px] focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)]"
            />
            <p className="text-[11px] text-text-faint mt-1">
              Type in any language — it&apos;s auto-translated to the market&apos;s language.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-text-faint mr-1">Market:</span>
            {STORE_KEYS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStore(s)}
                className={`px-3 h-8 rounded-[10px] text-[12px] border transition ${
                  store === s
                    ? "border-accent text-accent bg-[var(--accent-soft)]"
                    : "border-border text-text-dim hover:border-border-hover"
                }`}
              >
                {STORE_CONFIG[s].label}
              </button>
            ))}
            <span className="flex-1" />
            <Button variant="primary" size="sm" onClick={() => void run()} disabled={!canRun}>
              {busy ? "Researching…" : "Run research"}
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {notConfigured && (
            <p className="text-[13px] text-danger">
              DataForSEO isn&apos;t set up yet — add your API credentials in Settings.
            </p>
          )}
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {busy && (
            <p className="text-[13px] text-text-faint">
              Searching for “{productType.trim()}” in {STORE_CONFIG[store].label}… (~10–20s)
            </p>
          )}

          {result && (
            <>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <span className="text-[12px] text-text-dim">
                  <strong className="text-text">{result.found}</strong> keywords for{" "}
                  <strong className="text-text">{result.type}</strong>
                  {result.seeds.length > 0 && (
                    <span className="text-text-faint"> ({result.seeds.join(", ")})</span>
                  )}{" "}
                  · ≥ {result.minVolume.toLocaleString("en-US")}/mo
                </span>
                <button type="button" onClick={copyAll} className="text-[12px] text-accent hover:underline">
                  Copy all
                </button>
              </div>

              {result.keywords.length === 0 ? (
                <p className="text-[13px] text-text-faint">
                  No keywords above the threshold for this type in this market. Try a broader type or another market.
                </p>
              ) : (
                <table className="w-full text-[12px] border-collapse">
                  <colgroup>
                    <col />
                    <col className="w-[96px]" />
                    <col className="w-[168px]" />
                    <col className="w-[104px]" />
                  </colgroup>
                  <thead>
                    <tr className="text-text-faint text-left border-b border-border">
                      <th className="py-2 pr-3 font-medium">Keyword</th>
                      <th className="py-2 px-3 font-medium text-right">Volume/mo</th>
                      <th className="py-2 px-3 font-medium">Season</th>
                      <th className="py-2 pl-3 font-medium">Intent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.keywords.map((k, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="py-2 pr-3 text-text">{k.keyword}</td>
                        <td className="py-2 px-3 text-right font-medium tabular-nums text-text whitespace-nowrap">
                          {(k.volume ?? 0).toLocaleString("en-US")}
                        </td>
                        <td className="py-2 px-3 text-text-dim whitespace-nowrap">{seasonText(k)}</td>
                        <td className="py-2 pl-3">
                          {k.intent ? (
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                                k.intent === "transactional" || k.intent === "commercial"
                                  ? "bg-[var(--accent-soft)] text-accent"
                                  : "bg-bg-elev-2 text-text-faint"
                              }`}
                            >
                              {k.intent}
                            </span>
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-[11px] text-text-faint mt-3">
                “push” = start ~5–6 weeks before the peak. Cost: ~$0.10–0.25 per research.
              </p>
            </>
          )}

          {!result && !busy && !notConfigured && !error && (
            <p className="text-[13px] text-text-faint">
              Enter a <strong>product type</strong>, pick a market, and click <strong>Run research</strong>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
