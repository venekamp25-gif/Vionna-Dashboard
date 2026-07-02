"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { StoreKey, STORE_CONFIG, STORE_KEYS } from "@/lib/store";
import { Button } from "@/components/ui/Button";

type Kw = NonNullable<Awaited<ReturnType<typeof api.keywordResearchNiche>>["keywords"]>[number];

/**
 * Standalone keyword research (the DSA product-research strategy, automated):
 * pick a market → get trending high-volume womenswear keywords with monthly
 * search volume + seasonality (peak month + when to start pushing).
 */
export function KeywordResearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [store, setStore] = useState<StoreKey>("dk");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ store: StoreKey; found: number; minVolume: number; keywords: Kw[] } | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setNotConfigured(false);
    try {
      const r = await api.keywordResearchNiche({ store });
      if (!r.configured) {
        setNotConfigured(true);
        return;
      }
      setResult({ store, found: r.found ?? 0, minVolume: r.min_volume ?? 0, keywords: r.keywords ?? [] });
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
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-[16px] font-semibold text-text">Keyword research</h2>
            <p className="text-[12px] text-text-faint mt-0.5">
              Trending, high-volume dameskleding-keywords per markt — met zoekvolume en seizoen (piek-maand +
              wanneer te pushen).
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-text text-xl leading-none">
            ×
          </button>
        </div>

        <div className="px-6 py-3 border-b border-border flex items-center gap-2 flex-wrap">
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
          <Button variant="primary" size="sm" onClick={() => void run()} disabled={busy}>
            {busy ? "Onderzoeken…" : "Run research"}
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {notConfigured && (
            <p className="text-[13px] text-danger">
              DataForSEO is nog niet ingesteld — voeg je API-credentials toe in Settings.
            </p>
          )}
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {busy && (
            <p className="text-[13px] text-text-faint">
              Bezig met zoeken over ~19 categorieën in {STORE_CONFIG[store].label}… dit duurt ~10–40s.
            </p>
          )}
          {result && (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-text-dim">
                  <strong>{result.found}</strong> keywords · min. {result.minVolume.toLocaleString("nl-NL")}{" "}
                  zoekopdrachten/mnd
                </span>
                <button type="button" onClick={copyAll} className="text-[12px] text-accent hover:underline">
                  Copy all
                </button>
              </div>
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="text-text-faint text-left">
                    <th className="py-1.5 font-medium">Keyword</th>
                    <th className="py-1.5 font-medium text-right">Volume/mnd</th>
                    <th className="py-1.5 font-medium">Seizoen</th>
                    <th className="py-1.5 font-medium">Intentie</th>
                  </tr>
                </thead>
                <tbody>
                  {result.keywords.map((k, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1.5 pr-2">{k.keyword}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">
                        {(k.volume ?? 0).toLocaleString("nl-NL")}
                      </td>
                      <td className="py-1.5 text-text-dim">
                        {k.seasonality?.seasonal
                          ? `piek ${k.seasonality.peak_month} · push ${k.seasonality.push_from_month}`
                          : k.seasonality?.trend && k.seasonality.trend !== "flat"
                            ? k.seasonality.trend
                            : "—"}
                      </td>
                      <td className="py-1.5 text-text-faint">{k.intent ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-text-faint mt-3">
                "push" = ~5–6 weken vóór de piek beginnen. Kosten: ~$0,25 per markt-onderzoek.
              </p>
            </>
          )}
          {!result && !busy && !notConfigured && !error && (
            <p className="text-[13px] text-text-faint">
              Kies een markt en klik <strong>Run research</strong> om de trending keywords + zoekvolume op te halen.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
