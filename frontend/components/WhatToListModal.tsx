"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { StoreKey, STORE_CONFIG, STORE_KEYS } from "@/lib/store";
import { Button } from "@/components/ui/Button";

type TypeRow = NonNullable<Awaited<ReturnType<typeof api.whatToList>>["types"]>[number];
type Seasonality = TypeRow["seasonality"];

type StoreResult = {
  count?: number;
  types?: TypeRow[];
  recentTotal?: number;
  recentWindowDays?: number;
  cacheAgeSeconds?: number;
  fromCache?: boolean;
  error?: string;
  notConfigured?: boolean;
};

function agoText(seconds: number): string {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_FULL = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthNum(name?: string): number {
  return name ? MONTHS.indexOf(name) + 1 : 0;
}

type Bucket = "now" | "soon" | "evergreen" | "off";

function bucketOf(s: Seasonality): Bucket {
  if (!s?.seasonal || !s.peak_month || !s.push_from_month) return "evergreen";
  const now = new Date().getMonth() + 1;
  const push = monthNum(s.push_from_month);
  const peak = monthNum(s.peak_month);
  if (!push || !peak) return "evergreen";
  const inWindow = push <= peak ? now >= push && now <= peak : now >= push || now <= peak;
  if (inWindow) return "now";
  return ((push - now) + 12) % 12 <= 2 ? "soon" : "off";
}

function seasonText(s: Seasonality): string {
  if (s?.seasonal && s.peak_month) return `peak ${s.peak_month} → start ${s.push_from_month}`;
  if (s?.trend && s.trend !== "flat") return s.trend === "rising" ? "↑ rising demand" : "↓ falling demand";
  return "in demand all year";
}

/** The reasoning behind a recommendation: when to push it, and how saturated the
 *  category already is (total live + how many added in the last 45 days). */
function why(t: TypeRow): { season: string; tone: string; stock: string } {
  const b = (t.bucket ?? bucketOf(t.seasonality)) as Bucket;
  const s = t.seasonality;
  const season =
    b === "now"
      ? `in season now${s?.peak_month ? ` (peak ${s.peak_month})` : ""}`
      : b === "soon"
        ? `season starts ${s?.push_from_month ?? "soon"}${s?.peak_month ? ` → peak ${s.peak_month}` : ""}`
        : b === "evergreen"
          ? "in demand all year"
          : `out of season${s?.peak_month ? ` (peak ${s.peak_month})` : ""}`;
  const tone = b === "now" ? "text-green-600 dark:text-green-400" : b === "soon" ? "text-amber-500" : "text-text-dim";
  const live = (t.total_live ?? 0).toLocaleString("en-US");
  const r = t.recent_listed ?? 0;
  const stock = `${live} live · ${r === 0 ? "none added recently" : `${r} added in last 45d`}`;
  return { season, tone, stock };
}

const BUCKETS: { key: Bucket; title: string; tone: string }[] = [
  { key: "now", title: "🟢 In season now", tone: "text-green-600 dark:text-green-400" },
  { key: "soon", title: "🟡 Coming up", tone: "text-amber-500" },
  { key: "evergreen", title: "⚪ Evergreen", tone: "text-text-dim" },
  { key: "off", title: "⚫ Off-season", tone: "text-text-faint" },
];

/**
 * "What to list" — a recommendation of which product types to list next per
 * market, from (1) which season is coming up and (2) what the store has already
 * listed recently (so it favours in/near-season gaps). Shows its reasoning with
 * 3–5 keywords + volume + push season; deep keyword work lives in the 📊 tool.
 */
export function WhatToListModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selectedStores, setSelectedStores] = useState<StoreKey[]>(["dk"]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Partial<Record<StoreKey, StoreResult>> | null>(null);
  const [viewStore, setViewStore] = useState<StoreKey>("dk");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [competitorDomain, setCompetitorDomain] = useState("");

  const canRun = selectedStores.length > 0 && !busy;

  const toggleStore = (s: StoreKey) => {
    setSelectedStores((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
    if (results) {
      setResults(null);
      setError(null);
    }
  };

  const run = async (force = false) => {
    if (selectedStores.length === 0) return;
    setBusy(true);
    setError(null);
    setResults(null);
    setShowAll(false);
    try {
      const entries = await Promise.all(
        selectedStores.map(async (s): Promise<[StoreKey, StoreResult]> => {
          try {
            const r = await api.whatToList({ store: s, force });
            if (!r.configured) return [s, { notConfigured: true }];
            return [
              s,
              {
                count: r.count ?? 0,
                types: r.types ?? [],
                recentTotal: r.recent_total,
                recentWindowDays: r.recent_window_days,
                fromCache: r.from_cache,
                cacheAgeSeconds: r.cache_age_seconds,
              },
            ];
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
  const allTypes = active?.types ?? [];
  const recommended = allTypes.filter((t) => t.recommended);
  const fmt = (v: number | null | undefined) => (v ?? 0).toLocaleString("en-US");

  const grouped: Record<Bucket, TypeRow[]> = { now: [], soon: [], evergreen: [], off: [] };
  allTypes.forEach((t) => grouped[(t.bucket ?? bucketOf(t.seasonality)) as Bucket].push(t));

  const bestsellerUrl = (() => {
    const d = competitorDomain.trim();
    if (!d) return "";
    const host = d.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/\/+$/, "");
    if (!host || !host.includes(".")) return "";
    return `https://${host}/collections/all?q=&sort_by=best-selling`;
  })();

  const keywordPills = (t: TypeRow) => (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {t.keywords.map((k, i) => (
        <button
          key={i}
          type="button"
          title={`${fmt(k.volume)}/mo — click to copy`}
          onClick={() => copyText(k.keyword, `${t.seed}:${k.keyword}`)}
          className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-bg-elev text-[11px] text-text-dim hover:border-accent transition"
        >
          <span>{k.keyword}</span>
          <span className="text-text-faint tabular-nums">{fmt(k.volume)}</span>
          <span className="text-text-faint opacity-0 group-hover:opacity-100">
            {copied === `${t.seed}:${k.keyword}` ? "✓" : "⧉"}
          </span>
        </button>
      ))}
    </div>
  );

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
              A recommendation of which product types to list next, per market — from the season that&apos;s coming up
              and what you&apos;ve already listed recently.
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
            <strong>Recommend what to list</strong>. It ranks the product types worth listing next — favouring ones
            whose <strong>season is coming up</strong> that you <strong>haven&apos;t listed much lately</strong>.{" "}
            <button type="button" onClick={() => setShowMethod((v) => !v)} className="text-accent hover:underline">
              {showMethod ? "Hide the full method ▲" : "Show the full method ▼"}
            </button>
          </div>

          {showMethod && (
            <div className="text-[12px] text-text-dim leading-relaxed bg-bg-elev-2 rounded-[10px] px-3.5 py-3 border border-border space-y-1.5">
              <div className="font-semibold text-text">The product-research method (5 steps)</div>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  <strong>Find high-volume keywords</strong> — trending searches with enough monthly volume.{" "}
                  <span className="text-accent">✔ Automatic.</span>
                </li>
                <li>
                  <strong>Check the season</strong> — the tool reads Google Trends (shows when searches rise during the
                  year) and works out the best month to start listing — about 1–2 months before the yearly peak.{" "}
                  <span className="text-accent">✔ Automatic.</span>
                </li>
                <li>
                  <strong>Find big competitors</strong> — shops that already sell a lot (50,000+ visits/month). Tip:
                  the free PPSPY extension shows this; set its country to Germany or the UK.{" "}
                  <span className="text-text-faint">Manual step.</span>
                </li>
                <li>
                  <strong>Check their bestsellers</strong> — open the competitor&apos;s bestseller page and see which of
                  these types are on page 1. <span className="text-accent">✔ URL builder at the bottom.</span>
                </li>
                <li>
                  <strong>Import the winner</strong> — paste the product URL into the import screen.
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
              {busy ? "Working…" : `Recommend what to list${selectedStores.length > 1 ? ` (${selectedStores.length})` : ""}`}
            </Button>
          </div>
          <p className="text-[11px] text-text-faint">
            Scans ~19 categories + your recent listings per market (~15–25s, ~$0.25 of research budget per market). The
            result is saved for 12 hours, so re-opening is free — use <strong>Refresh</strong> for a new scan.
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {busy && (
            <p className="text-[13px] text-text-faint">
              Checking {selectedStores.map((s) => STORE_CONFIG[s].label).join(", ")} — demand, season and recent
              listings…
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
                <div className="space-y-4">
                  <p className="text-[12px] text-text-dim leading-relaxed">
                    Today is <strong className="text-text">{MONTH_FULL[new Date().getMonth() + 1]}</strong>. Ranked for{" "}
                    <strong className="text-text">{STORE_CONFIG[viewStore].label}</strong>
                    {typeof active.recentTotal === "number" && (
                      <> using its last {active.recentWindowDays ?? 45} days of listings ({active.recentTotal} products)</>
                    )}
                    . Each name is a product type (with the local search word in brackets); the keywords under it show
                    why.
                  </p>

                  <div className="flex items-center gap-2 flex-wrap -mt-1.5">
                    {active.fromCache && typeof active.cacheAgeSeconds === "number" ? (
                      <span className="text-[11px] text-text-faint">
                        Saved result · updated {agoText(active.cacheAgeSeconds)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-faint">Fresh scan · just updated</span>
                    )}
                    <button
                      type="button"
                      onClick={() => void run(true)}
                      disabled={busy}
                      className="text-[11px] text-accent hover:underline disabled:opacity-50"
                      title="Run a new paid scan for the selected market(s)"
                    >
                      ↻ Refresh
                    </button>
                  </div>

                  {/* Ranked recommendation */}
                  <div className="space-y-2.5">
                    {recommended.map((t, i) => {
                      const w = why(t);
                      return (
                        <div key={t.seed} className="rounded-[10px] border border-border bg-bg-elev-2 px-3 py-2.5 flex gap-3">
                          <div className="shrink-0 w-6 h-6 rounded-full bg-[var(--accent-soft)] text-accent text-[12px] font-semibold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-[13px] font-semibold text-text">{t.label}</span>
                              <span className="text-[11px] text-text-faint">({t.seed})</span>
                              <span className="text-[11px] text-text-dim tabular-nums">· up to {fmt(t.volume)}/mo</span>
                            </div>
                            <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap">
                              <span className={w.tone}>● {w.season}</span>
                              <span className="text-text-faint">·</span>
                              <span className="text-text-faint">{w.stock}</span>
                            </div>
                            {keywordPills(t)}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-[11px] text-text-faint leading-relaxed">
                    Ranked by demand + season timing, minus how saturated the category already is (total products live
                    + how many you added in the last 45 days). Keyword numbers are monthly searches. Next: use the
                    bestseller finder below to check real competitors are already selling these.
                  </p>

                  {/* Full breakdown */}
                  <div className="border-t border-border pt-3">
                    <button
                      type="button"
                      onClick={() => setShowAll((v) => !v)}
                      className="text-[12px] text-accent hover:underline"
                    >
                      {showAll ? "Hide all types by season ▲" : `Show all ${allTypes.length} types by season ▼`}
                    </button>
                    {showAll && (
                      <div className="space-y-4 mt-3">
                        {BUCKETS.map(({ key, title, tone }) => {
                          const list = grouped[key];
                          if (list.length === 0) return null;
                          return (
                            <div key={key}>
                              <h3 className={`text-[12px] font-semibold ${tone} mb-1.5`}>
                                {title} <span className="text-text-faint font-normal">({list.length})</span>
                              </h3>
                              <div className="flex flex-wrap gap-1.5">
                                {list.map((t) => (
                                  <span
                                    key={t.seed}
                                    title={`${seasonText(t.seasonality)} · ${t.total_live ?? 0} live · ${t.recent_listed ?? 0} added in last 45d`}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-bg-elev-2 text-[11px] text-text-dim"
                                  >
                                    {t.recommended && <span className="text-amber-500">★</span>}
                                    <span className="text-text">{t.label}</span>
                                    <span className="text-text-faint">({t.seed})</span>
                                    <span className="text-text-faint tabular-nums">{fmt(t.volume)}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}

          {!results && !busy && !error && (
            <p className="text-[13px] text-text-faint">
              Choose a market above and press <strong>Recommend what to list</strong>.
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
                  bestsellerUrl ? "border-accent text-accent hover:bg-[var(--accent-soft)]" : "border-border text-text-faint pointer-events-none opacity-50"
                }`}
              >
                Open ↗
              </a>
            </div>
            {bestsellerUrl && <p className="text-[11px] text-text-faint mt-1.5 break-all">{bestsellerUrl}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
