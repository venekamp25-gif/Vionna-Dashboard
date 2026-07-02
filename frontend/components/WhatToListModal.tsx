"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { StoreKey, STORE_CONFIG, STORE_KEYS } from "@/lib/store";
import { Button } from "@/components/ui/Button";

type Kw = NonNullable<Awaited<ReturnType<typeof api.keywordResearchNiche>>["keywords"]>[number];

type StoreResult = {
  found?: number;
  minVolume?: number;
  keywords?: Kw[];
  error?: string;
  notConfigured?: boolean;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_FULL = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthNum(name?: string): number {
  return name ? MONTHS.indexOf(name) + 1 : 0;
}

type Bucket = "now" | "soon" | "evergreen" | "off";

/** Which "should I list this now?" bucket a keyword falls into, from its
 * seasonality + today's month. Mirrors the DSA method: list when a type is in
 * its start→peak window, prepare when that window is ~1–2 months out. */
function bucketOf(k: Kw): Bucket {
  const s = k.seasonality;
  if (!s?.seasonal || !s.peak_month || !s.push_from_month) return "evergreen";
  const now = new Date().getMonth() + 1;
  const push = monthNum(s.push_from_month);
  const peak = monthNum(s.peak_month);
  if (!push || !peak) return "evergreen";
  const inWindow = push <= peak ? now >= push && now <= peak : now >= push || now <= peak;
  if (inWindow) return "now";
  const monthsUntilPush = ((push - now) + 12) % 12;
  return monthsUntilPush <= 2 ? "soon" : "off";
}

function seasonText(k: Kw): string {
  const s = k.seasonality;
  if (s?.seasonal && s.peak_month) return `peak ${s.peak_month} → start ${s.push_from_month}`;
  if (s?.trend && s.trend !== "flat") return s.trend === "rising" ? "↑ rising" : "↓ falling";
  return "evergreen";
}

const BUCKETS: { key: Bucket; title: string; blurb: string; tone: string }[] = [
  { key: "now", title: "🟢 List these NOW", blurb: "In season right now — the best time to list them. Highest priority.", tone: "text-green-600 dark:text-green-400" },
  { key: "soon", title: "🟡 Coming up (prepare)", blurb: "Season starts within ~1–2 months — get these ready to publish soon.", tone: "text-amber-500" },
  { key: "evergreen", title: "⚪ Evergreen (always safe)", blurb: "In demand all year — safe to list any time.", tone: "text-text-dim" },
  { key: "off", title: "⚫ Off-season (skip for now)", blurb: "Out of season right now — revisit closer to their start month.", tone: "text-text-faint" },
];

/**
 * "What to list" — the DSA product-research method, automated. Instead of
 * researching a known product type (that's the 📊 tool), this answers the
 * reverse question a product researcher starts with: *which* product types are
 * worth listing right now in each market? It sweeps the womenswear categories,
 * then sorts them by seasonal timing (list now / coming up / evergreen / off).
 */
export function WhatToListModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selectedStores, setSelectedStores] = useState<StoreKey[]>(["dk"]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Partial<Record<StoreKey, StoreResult>> | null>(null);
  const [viewStore, setViewStore] = useState<StoreKey>("dk");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);

  // Bestseller-URL helper (DSA step 4).
  const [competitorDomain, setCompetitorDomain] = useState("");

  const canRun = selectedStores.length > 0 && !busy;

  const toggleStore = (s: StoreKey) => {
    setSelectedStores((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
    if (results) {
      setResults(null);
      setError(null);
    }
  };

  const run = async () => {
    if (selectedStores.length === 0) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const entries = await Promise.all(
        selectedStores.map(async (s): Promise<[StoreKey, StoreResult]> => {
          try {
            const r = await api.keywordResearchNiche({ store: s }); // no product_type → full category sweep
            if (!r.configured) return [s, { notConfigured: true }];
            return [s, { found: r.found ?? 0, minVolume: r.min_volume ?? 0, keywords: r.keywords ?? [] }];
          } catch (e) {
            return [s, { error: e instanceof Error ? e.message : "failed" }];
          }
        })
      );
      const res: Partial<Record<StoreKey, StoreResult>> = {};
      entries.forEach(([s, v]) => (res[s] = v));
      setResults(res);
      setViewStore(selectedStores[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setBusy(false);
    }
  };

  const copyText = (text: string, tag: string) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text);
    setCopied(tag);
    window.setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1200);
  };

  if (!open) return null;

  const resultStores = results ? (STORE_KEYS.filter((s) => results[s]) as StoreKey[]) : [];
  const active = results?.[viewStore];
  const grouped: Record<Bucket, Kw[]> = { now: [], soon: [], evergreen: [], off: [] };
  (active?.keywords ?? []).forEach((k) => grouped[bucketOf(k)].push(k));
  (Object.keys(grouped) as Bucket[]).forEach((b) =>
    grouped[b].sort((a, c) => (c.volume ?? 0) - (a.volume ?? 0))
  );

  const bestsellerUrl = (() => {
    const d = competitorDomain.trim();
    if (!d) return "";
    let host = d.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/\/+$/, "");
    if (!host || !host.includes(".")) return "";
    return `https://${host}/collections/all?q=&sort_by=best-selling`;
  })();

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-elev border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-[16px] font-semibold text-text">What to list</h2>
            <p className="text-[12px] text-text-faint mt-0.5">
              Which product types are worth listing right now, per market — ranked by demand and season.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-text text-xl leading-none">
            ×
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 py-4 border-b border-border shrink-0 space-y-3">
          <div className="text-[12px] text-text-dim leading-relaxed bg-bg-elev-2 rounded-[10px] px-3.5 py-3 border border-border">
            <strong className="text-text">Not sure what to research?</strong> Pick a market and press{" "}
            <strong>Find what to list</strong>. The tool scans the top women&apos;s-fashion searches in that country
            and sorts them by <strong>when it&apos;s the right season to list them</strong> — so you get a direct
            answer to “what should I put in the store now?”.{" "}
            <button
              type="button"
              onClick={() => setShowMethod((v) => !v)}
              className="text-accent hover:underline"
            >
              {showMethod ? "Hide the full method ▲" : "Show the full method ▼"}
            </button>
          </div>

          {showMethod && (
            <div className="text-[12px] text-text-dim leading-relaxed bg-bg-elev-2 rounded-[10px] px-3.5 py-3 border border-border space-y-1.5">
              <div className="font-semibold text-text">The product-research method (5 steps)</div>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  <strong>Find high-volume keywords</strong> — trending searches in the niche with enough monthly
                  volume. <span className="text-accent">✔ This tool does it automatically.</span>
                </li>
                <li>
                  <strong>Check the season</strong> — some products only sell well at certain times of year. The tool
                  reads Google Trends (a free Google tool that shows when searches for something rise during the year)
                  and works out the best month to start listing — about 1–2 months before the yearly peak.{" "}
                  <span className="text-accent">✔ Done for you (the “start” month).</span>
                </li>
                <li>
                  <strong>Find big competitors</strong> — other shops that already sell a lot (50,000+ visitors a
                  month). Tip: the free PPSPY browser extension shows a shop&apos;s visitor numbers; set its country to
                  Germany or the UK (not the country you advertise in) to see the biggest players.{" "}
                  <span className="text-text-faint">Manual step.</span>
                </li>
                <li>
                  <strong>Check their bestsellers</strong> — open the competitor&apos;s bestseller page and see which of
                  these product types show up on page 1. <span className="text-accent">✔ Use the URL builder at the bottom.</span>
                </li>
                <li>
                  <strong>Import the winner</strong> — paste that product&apos;s URL into the dashboard&apos;s import screen.
                </li>
              </ol>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-text-faint mr-1">Market:</span>
            {STORE_KEYS.map((s) => {
              const on = selectedStores.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStore(s)}
                  aria-pressed={on}
                  className={`px-3 h-8 rounded-[10px] text-[12px] border transition flex items-center gap-1.5 ${
                    on ? "border-accent text-accent bg-[var(--accent-soft)]" : "border-border text-text-dim hover:border-border-hover"
                  }`}
                >
                  <span className={`text-[10px] ${on ? "text-accent" : "text-text-faint"}`}>{on ? "✓" : "○"}</span>
                  {STORE_CONFIG[s].label}
                </button>
              );
            })}
            <span className="flex-1" />
            <Button variant="primary" size="sm" onClick={() => void run()} disabled={!canRun}>
              {busy ? "Scanning…" : `Find what to list${selectedStores.length > 1 ? ` (${selectedStores.length})` : ""}`}
            </Button>
          </div>
          <p className="text-[11px] text-text-faint">
            Scans ~19 categories per market (~15–25s). Uses about $0.25 of research budget per market, so avoid
            re-running it needlessly.
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {busy && (
            <p className="text-[13px] text-text-faint">
              Scanning {selectedStores.map((s) => STORE_CONFIG[s].label).join(", ")} for what&apos;s in demand…
            </p>
          )}

          {results && !busy && (
            <>
              {resultStores.length > 1 && (
                <div className="flex items-center gap-1 mb-3 border-b border-border">
                  {resultStores.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setViewStore(s)}
                      className={`px-3 py-1.5 text-[12px] -mb-px border-b-2 transition ${
                        viewStore === s ? "border-accent text-accent" : "border-transparent text-text-dim hover:text-text"
                      }`}
                    >
                      {STORE_CONFIG[s].label}
                    </button>
                  ))}
                </div>
              )}

              {active?.notConfigured ? (
                <p className="text-[13px] text-danger">
                  DataForSEO isn&apos;t set up yet — add your API credentials in Settings to use this.
                </p>
              ) : active?.error ? (
                <p className="text-[13px] text-danger">{active.error}</p>
              ) : active ? (
                <div className="space-y-5">
                  <p className="text-[12px] text-text-dim">
                    Today is <strong className="text-text">{MONTH_FULL[new Date().getMonth() + 1]}</strong>. Start at the
                    top — the green group is what to list first.
                  </p>
                  {BUCKETS.map(({ key, title, blurb, tone }) => {
                    const list = grouped[key];
                    if (list.length === 0) return null;
                    return (
                      <div key={key}>
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <h3 className={`text-[13px] font-semibold ${tone}`}>
                            {title} <span className="text-text-faint font-normal">({list.length})</span>
                          </h3>
                        </div>
                        <p className="text-[11px] text-text-faint mb-2">{blurb}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {list.map((k, i) => (
                            <button
                              key={i}
                              type="button"
                              title={`${(k.volume ?? 0).toLocaleString("en-US")}/mo · ${seasonText(k)} — click to copy`}
                              onClick={() => copyText(k.keyword, k.keyword)}
                              className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] transition ${
                                key === "now"
                                  ? "border-green-500/40 bg-green-500/[0.08] text-green-700 dark:text-green-300"
                                  : "border-border bg-bg-elev-2 text-text-dim hover:border-accent"
                              }`}
                            >
                              {k.recommended && <span className="text-amber-500">★</span>}
                              <span>{k.keyword}</span>
                              <span className="text-text-faint tabular-nums">{(k.volume ?? 0).toLocaleString("en-US")}</span>
                              <span className="text-text-faint opacity-0 group-hover:opacity-100">
                                {copied === k.keyword ? "✓" : "⧉"}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[11px] text-text-faint pt-1 border-t border-border">
                    <span className="text-amber-500">★</span> = recommended (best mix of search volume, buyers and
                    timing). Numbers are monthly searches. Next: use the bestseller finder below to confirm real
                    competitors are already selling these.
                  </p>
                </div>
              ) : null}
            </>
          )}

          {!results && !busy && !error && (
            <p className="text-[13px] text-text-faint">
              Choose a market above and press <strong>Find what to list</strong> to see what&apos;s in demand right now.
            </p>
          )}

          {/* Bestseller URL helper (DSA step 4) */}
          <div className="mt-6 pt-4 border-t border-border">
            <div className="text-[12px] font-semibold text-text mb-1">Competitor bestseller finder</div>
            <p className="text-[11px] text-text-faint mb-2 leading-relaxed">
              Paste a competitor&apos;s domain and open their store sorted by <strong>best-selling</strong> — the products
              at the top are their winners. Check which of the types above appear on page 1.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={competitorDomain}
                onChange={(e) => setCompetitorDomain(e.target.value)}
                placeholder="e.g. noirlndn.com"
                className="flex-1 px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[12px] focus:outline-none focus:border-accent"
              />
              <Button variant="secondary" size="sm" onClick={() => bestsellerUrl && copyText(bestsellerUrl, "url")} disabled={!bestsellerUrl}>
                {copied === "url" ? "✓ Copied" : "Copy URL"}
              </Button>
              <a
                href={bestsellerUrl || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-[12px] px-3 h-9 inline-flex items-center rounded-[10px] border transition ${
                  bestsellerUrl
                    ? "border-accent text-accent hover:bg-[var(--accent-soft)]"
                    : "border-border text-text-faint pointer-events-none opacity-50"
                }`}
              >
                Open ↗
              </a>
            </div>
            {bestsellerUrl && (
              <p className="text-[11px] text-text-faint mt-1.5 break-all">{bestsellerUrl}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
