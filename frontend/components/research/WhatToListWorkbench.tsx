"use client";

import { useEffect, useState } from "react";
import { api, WtlStore } from "@/lib/api";
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

/** Section shell: numbered step, title, one-line explanation, optional action row —
 *  every step gets the same calm, spacious card so the page reads top-to-bottom. */
function Section({
  id,
  step,
  title,
  intro,
  children,
}: {
  id?: string;
  step?: string;
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-bg-elev border border-border rounded-2xl p-6 lg:p-8">
      <div className="flex items-start gap-4 mb-6">
        {step && (
          <div className="shrink-0 w-9 h-9 rounded-full bg-[var(--accent-soft)] text-accent text-[15px] font-bold flex items-center justify-center">
            {step}
          </div>
        )}
        <div>
          <h2 className="text-[16px] font-semibold text-text">{title}</h2>
          <p className="text-[12.5px] text-text-dim mt-1 leading-relaxed max-w-3xl">{intro}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Full-screen "What to list" research workbench (own browser tab).
 * The complete flow, one calm section per step:
 * ① product types (season + catalogue gaps) → ② stores (local traffic) →
 * ③ products (their bestsellers) → Import (opens the dashboard prefilled).
 */
export function WhatToListWorkbench() {
  const [selectedStores, setSelectedStores] = useState<StoreKey[]>(["dk"]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Partial<Record<StoreKey, StoreResult>> | null>(null);
  const [viewStore, setViewStore] = useState<StoreKey>("dk");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [competitorDomain, setCompetitorDomain] = useState("");
  const [scan, setScan] = useState<Awaited<ReturnType<typeof api.bestsellerScan>> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [movers, setMovers] = useState<Awaited<ReturnType<typeof api.bestsellerMovers>> | null>(null);
  const [moversLoading, setMoversLoading] = useState(false);

  const [funnelType, setFunnelType] = useState<TypeRow | null>(null);
  const [wtlStores, setWtlStores] = useState<Awaited<ReturnType<typeof api.wtlStores>> | null>(null);
  const [storesLoading, setStoresLoading] = useState(false);
  const [onlyEnough, setOnlyEnough] = useState(true);
  const [trafficRefreshing, setTrafficRefreshing] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);
  const [addDomain, setAddDomain] = useState("");
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [scanStore, setScanStore] = useState<WtlStore | null>(null);
  const [onlyType, setOnlyType] = useState(true);

  const moversStore = selectedStores[0] ?? "dk";
  useEffect(() => {
    setMoversLoading(true);
    api.bestsellerMovers(moversStore)
      .then(setMovers)
      .catch(() => setMovers(null))
      .finally(() => setMoversLoading(false));
  }, [moversStore]);

  const funnelMarket: StoreKey = results ? viewStore : (selectedStores[0] ?? "dk");
  useEffect(() => {
    setStoresLoading(true);
    api.wtlStores(funnelMarket)
      .then(setWtlStores)
      .catch(() => setWtlStores(null))
      .finally(() => setStoresLoading(false));
  }, [funnelMarket]);

  const scrollToId = (id: string) =>
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);

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

  const refreshTraffic = async () => {
    setTrafficRefreshing(true);
    try {
      const start = await api.wtlStoresRefresh();
      if (!start.job_id) throw new Error(start.error || "could not start");
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const j = await api.metaJobStatus(start.job_id).catch(() => null);
        if (j && j.status !== "running") break;
      }
      setWtlStores(await api.wtlStores(funnelMarket));
    } catch {
      /* stores list simply stays as-is */
    } finally {
      setTrafficRefreshing(false);
    }
  };

  const [classifying, setClassifying] = useState(false);
  /** Dropship-check for stores without a fresh verdict (shipping policy + brand signals). */
  const classifyStores = async () => {
    setClassifying(true);
    try {
      const start = await api.wtlStoresClassify(10);
      if (!start.job_id) throw new Error(start.error || "could not start");
      for (let i = 0; i < 400; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const j = await api.metaJobStatus(start.job_id).catch(() => null);
        if (j && j.status !== "running") break;
      }
      setWtlStores(await api.wtlStores(funnelMarket));
    } catch {
      /* list stays as-is */
    } finally {
      setClassifying(false);
    }
  };

  /** Google hunt for UNKNOWN local stores (the research scraper's method, server-side). */
  const discoverStores = async () => {
    setDiscovering(true);
    setDiscoverMsg(null);
    try {
      const start = await api.wtlDiscover([funnelMarket]);
      if (!start.job_id) throw new Error(start.error || "could not start");
      let summary = "";
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const j = await api.metaJobStatus(start.job_id).catch(() => null);
        if (j && j.status !== "running") {
          summary = j.summary || "";
          break;
        }
      }
      setDiscoverMsg(summary ? `✓ ${summary}` : "✓ done");
      setWtlStores(await api.wtlStores(funnelMarket));
    } catch (e) {
      setDiscoverMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setDiscovering(false);
    }
  };

  const addStore = async () => {
    const d = addDomain.trim();
    if (!d) return;
    setAddMsg(null);
    try {
      const r = await api.wtlStoreAdd(d);
      if (r.error) {
        setAddMsg(r.error);
        return;
      }
      setAddDomain("");
      setAddMsg(`✓ ${r.domain} added — press "Update traffic" to fetch its visitors`);
      setWtlStores(await api.wtlStores(funnelMarket));
    } catch (e) {
      setAddMsg(e instanceof Error ? e.message : "failed");
    }
  };

  /** Hand-off to the dashboard: open it in a new tab with the URL prefilled. */
  const importProduct = (url: string) => {
    // /fashion, NOT "/" — "/" is the portal picker; InputStep reads ?import= there.
    window.open(`/fashion?import=${encodeURIComponent(url)}`, "_blank");
  };

  const runScan = async (domain?: string, force = false, fromStore?: WtlStore) => {
    const d = (domain ?? competitorDomain).trim();
    if (!d) return;
    if (domain) setCompetitorDomain(domain);
    setScanStore(fromStore ?? (wtlStores?.stores ?? []).find((s) => s.domain === d) ?? null);
    setScanning(true);
    setScan(null);
    scrollToId("step-products");
    try {
      setScan(await api.bestsellerScan(d, force));
    } catch (e) {
      setScan({ ok: false, blocked: e instanceof Error ? e.message : "scan failed" });
    } finally {
      setScanning(false);
    }
  };

  const copyText = (text: string, tag: string) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text);
    setCopied(tag);
    window.setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1200);
  };

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
    <div className="flex flex-wrap gap-1.5 mt-2.5">
      {t.keywords.map((k, i) => (
        <button
          key={i}
          type="button"
          title={`${fmt(k.volume)}/mo — click to copy`}
          onClick={() => copyText(k.keyword, `${t.seed}:${k.keyword}`)}
          className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-bg-elev-2 text-[11px] text-text-dim hover:border-accent transition"
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
    <div className="min-h-screen">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-40 bg-bg/90 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-14 flex items-center gap-4">
          <span className="text-[15px] font-semibold text-text">🔎 Product research</span>
          <nav className="hidden md:flex items-center gap-1 text-[12px] text-text-dim">
            {[
              ["step-types", "① Product types"],
              ["step-stores", "② Stores"],
              ["step-products", "③ Products"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollToId(id)}
                className="px-2.5 py-1 rounded-md hover:bg-bg-elev-2 hover:text-text transition"
              >
                {label}
              </button>
            ))}
          </nav>
          <span className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-faint mr-1">Market:</span>
            {STORE_KEYS.map((s) => {
              const on = selectedStores.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStore(s)}
                  aria-pressed={on}
                  className={`px-2.5 h-8 rounded-[10px] text-[12px] border transition ${
                    on ? "border-accent text-accent bg-[var(--accent-soft)]" : "border-border text-text-dim hover:border-border-hover"
                  }`}
                >
                  {STORE_CONFIG[s].label.replace("Store ", "")}
                </button>
              );
            })}
          </div>
          <a href="/" className="text-[12px] text-accent hover:underline whitespace-nowrap">
            ← Dashboard
          </a>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-8 space-y-8">
        {/* Intro / run */}
        <section className="bg-bg-elev border border-border rounded-2xl p-6 lg:p-8">
          <div className="flex flex-col lg:flex-row lg:items-center gap-5">
            <div className="flex-1">
              <h1 className="text-[19px] font-semibold text-text">What to list</h1>
              <p className="text-[13px] text-text-dim mt-1.5 leading-relaxed max-w-3xl">
                The full research flow in one place: <strong>① product types</strong> (season + your catalogue gaps) →{" "}
                <strong>② stores</strong> (competitors with real local traffic) → <strong>③ products</strong> (their
                bestsellers) → <strong>Import</strong>. Pick your market top-right and start below.{" "}
                <button type="button" onClick={() => setShowMethod((v) => !v)} className="text-accent hover:underline">
                  {showMethod ? "Hide the method ▲" : "Show the full method ▼"}
                </button>
              </p>
            </div>
            <div className="shrink-0 flex flex-col items-start lg:items-end gap-2">
              <Button variant="primary" onClick={() => void run()} disabled={!canRun}>
                {busy ? "Working…" : `Recommend what to list${selectedStores.length > 1 ? ` (${selectedStores.length})` : ""}`}
              </Button>
              <p className="text-[11px] text-text-faint max-w-[260px] lg:text-right">
                ~15–25s and ~$0.25 research budget per market. Saved for 12 hours — reopening is free.
              </p>
            </div>
          </div>

          {showMethod && (
            <div className="mt-5 text-[12.5px] text-text-dim leading-relaxed bg-bg-elev-2 rounded-[12px] px-5 py-4 border border-border space-y-1.5 max-w-3xl">
              <div className="font-semibold text-text">The product-research method (5 steps)</div>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  <strong>Find high-volume keywords</strong> — 20,000+ monthly searches.{" "}
                  <span className="text-accent">✔ Automatic.</span>
                </li>
                <li>
                  <strong>Check the season</strong> — Google-Trends-style curves; start ~5 weeks before the uptrend.{" "}
                  <span className="text-accent">✔ Automatic.</span>
                </li>
                <li>
                  <strong>Find big competitors</strong> — stores with 50,000+ visitors/month.{" "}
                  <span className="text-accent">✔ Step ② below.</span>
                </li>
                <li>
                  <strong>Check their bestsellers</strong> — page 1 of their best-selling collection.{" "}
                  <span className="text-accent">✔ Step ③ below.</span>
                </li>
                <li>
                  <strong>Import the winner</strong> — one click, the import screen opens prefilled.
                </li>
              </ol>
            </div>
          )}
        </section>

        {/* ① Product types */}
        <Section
          id="step-types"
          step="①"
          title="Product types — what to list next"
          intro={
            <>
              Ranked for the season that&apos;s coming up and what you haven&apos;t listed much lately. Each card names
              a product type (local search word in brackets); the keywords under it show why. Press{" "}
              <strong>Find stores →</strong> on a type to continue the flow.
            </>
          }
        >
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {busy && (
            <p className="text-[13px] text-text-faint">
              Checking {selectedStores.map((s) => STORE_CONFIG[s].label).join(", ")} — demand, season and recent
              listings…
            </p>
          )}
          {!results && !busy && !error && (
            <p className="text-[13px] text-text-faint">
              No research yet — press <strong>Recommend what to list</strong> at the top.
            </p>
          )}

          {results && !busy && (
            <>
              {resultStores.length > 1 && (
                <div className="flex items-center gap-1 mb-5 border-b border-border">
                  {resultStores.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setViewStore(s)}
                      className={`px-3.5 py-2 text-[12.5px] -mb-px border-b-2 transition ${
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
                  <div className="flex items-center gap-3 flex-wrap text-[12px] text-text-dim">
                    <span>
                      Today is <strong className="text-text">{MONTH_FULL[new Date().getMonth() + 1]}</strong> · ranked
                      for <strong className="text-text">{STORE_CONFIG[viewStore].label}</strong>
                      {typeof active.recentTotal === "number" && (
                        <> · last {active.recentWindowDays ?? 45} days: {active.recentTotal} products listed</>
                      )}
                    </span>
                    <span className="text-text-faint">
                      {active.fromCache && typeof active.cacheAgeSeconds === "number"
                        ? `Saved result · updated ${agoText(active.cacheAgeSeconds)}`
                        : "Fresh scan · just updated"}
                    </span>
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

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {recommended.map((t, i) => {
                      const w = why(t);
                      return (
                        <div key={t.seed} className="rounded-[14px] border border-border bg-bg-elev-2 px-5 py-4 flex gap-4">
                          <div className="shrink-0 w-7 h-7 rounded-full bg-[var(--accent-soft)] text-accent text-[13px] font-semibold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-[14px] font-semibold text-text">{t.label}</span>
                              <span className="text-[11px] text-text-faint">({t.seed})</span>
                              <span className="text-[11px] text-text-dim tabular-nums">· up to {fmt(t.volume)}/mo</span>
                              {t.meets_doc_volume && (
                                <span
                                  className="text-[10px] font-semibold text-green-600 dark:text-green-400"
                                  title="Meets the research doc's step-1 bar: ≥ 20,000 monthly searches"
                                >
                                  ✓ 20k+
                                </span>
                              )}
                            </div>
                            <div className="text-[11.5px] mt-1 flex items-center gap-1.5 flex-wrap">
                              <span className={w.tone}>● {w.season}</span>
                              <span className="text-text-faint">·</span>
                              <span className="text-text-faint">{w.stock}</span>
                            </div>
                            {keywordPills(t)}
                          </div>
                          <div className="shrink-0 self-center">
                            <Button
                              variant={funnelType?.seed === t.seed ? "primary" : "secondary"}
                              size="sm"
                              onClick={() => {
                                setFunnelType(t);
                                setOnlyType(true);
                                scrollToId("step-stores");
                              }}
                              title="Step 2: see which competitor stores in this market have enough local traffic — then open their bestsellers for this type"
                            >
                              Find stores →
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-[11.5px] text-text-faint leading-relaxed max-w-3xl">
                    Ranked by demand + season timing, minus how saturated the category already is (total products live
                    + how many you added in the last 45 days). Keyword numbers are monthly searches.
                  </p>

                  <div className="border-t border-border pt-4">
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[12px] text-accent hover:underline">
                      {showAll ? "Hide all types by season ▲" : `Show all ${allTypes.length} types by season ▼`}
                    </button>
                    {showAll && (
                      <div className="space-y-4 mt-4">
                        {BUCKETS.map(({ key, title, tone }) => {
                          const list = grouped[key];
                          if (list.length === 0) return null;
                          return (
                            <div key={key}>
                              <h3 className={`text-[12px] font-semibold ${tone} mb-2`}>
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
        </Section>

        {/* Trending at competitors */}
        <Section
          title="📈 Trending at your competitors"
          intro={
            <>
              Products that are <strong>new</strong> on a known competitor&apos;s bestseller page or{" "}
              <strong>climbed 5+ spots</strong> in the last week — strong signals they&apos;re selling right now.
              Ranked like the recommendation above; products you already imported are hidden.
            </>
          }
        >
          {moversLoading ? (
            <p className="text-[12px] text-text-faint">Checking competitor bestseller pages… (~10s)</p>
          ) : !movers ? (
            <p className="text-[12px] text-text-faint">Couldn&apos;t check right now — try reloading this page.</p>
          ) : movers.movers.length === 0 ? (
            <p className="text-[12px] text-text-faint">
              No new risers this week ({movers.checked} stores checked).
              {movers.baseline.length > 0 && (
                <> First baseline saved for {movers.baseline.length} store{movers.baseline.length === 1 ? "" : "s"} — risers show up from next week.</>
              )}
            </p>
          ) : (
            (() => {
              const order: string[] = [];
              const byCat: Record<string, typeof movers.movers> = {};
              movers.movers.forEach((m) => {
                if (!byCat[m.category]) {
                  byCat[m.category] = [];
                  order.push(m.category);
                }
                byCat[m.category].push(m);
              });
              const seasonLabel: Record<string, { text: string; tone: string }> = {
                now: { text: "● in season now", tone: "text-green-600 dark:text-green-400" },
                soon: { text: "● season coming up", tone: "text-amber-500" },
                evergreen: { text: "in demand all year", tone: "text-text-dim" },
                off: { text: "off-season", tone: "text-text-faint" },
              };
              return (
                <div className="space-y-5">
                  {order.map((cat) => {
                    const ctx = movers.category_context?.[cat];
                    const season = ctx?.bucket ? seasonLabel[ctx.bucket] : null;
                    return (
                      <div key={cat}>
                        <div className="flex items-baseline gap-2 flex-wrap mb-2">
                          <span className="text-[13px] font-semibold text-text capitalize">{cat}</span>
                          {season && <span className={`text-[11px] ${season.tone}`}>{season.text}</span>}
                          {ctx && (
                            <span className="text-[11px] text-text-faint">
                              {ctx.live} live · {ctx.recent === 0 ? "none added" : `${ctx.recent} added`} in last 45d
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3">
                          {byCat[cat].map((m) => (
                            <a
                              key={`${m.domain}:${m.handle}`}
                              href={m.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`${m.title} — ${m.signal === "new" ? `new at #${m.position}` : `#${m.old_position} → #${m.position}`} at ${m.domain}`}
                              className="rounded-[12px] border border-border bg-bg-elev-2 overflow-hidden hover:border-accent transition group relative"
                            >
                              <span
                                className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  m.signal === "new" ? "bg-accent text-on-accent" : "bg-amber-500 text-white"
                                }`}
                              >
                                {m.signal === "new" ? `NEW #${m.position}` : `↑ +${(m.old_position ?? 0) - m.position} → #${m.position}`}
                              </span>
                              {m.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={m.image} alt="" className="w-full h-32 object-cover" loading="lazy" />
                              ) : (
                                <div className="w-full h-32 bg-bg-elev" />
                              )}
                              <div className="px-2.5 py-2">
                                <div className="text-[11px] text-text truncate group-hover:text-accent">{m.title}</div>
                                <div className="text-[10px] text-text-faint truncate">{m.domain}</div>
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {movers.season_source !== "what_to_list" && (
                    <p className="text-[11px] text-text-faint">
                      Tip: run <strong>Recommend what to list</strong> first — then this ranking also uses each
                      type&apos;s season timing (now it only uses your catalogue gaps).
                    </p>
                  )}
                </div>
              );
            })()
          )}
        </Section>

        {/* ② Stores */}
        <Section
          id="step-stores"
          step="②"
          title={`Stores — competitors with real traffic in ${STORE_CONFIG[funnelMarket].label}`}
          intro={
            <>
              Competitor stores ranked by a <strong>0-100 score</strong>: SimilarWeb visitors{" "}
              <strong>inside this market&apos;s country</strong>
              {wtlStores?.country ? ` (${wtlStores.country})` : ""} as the backbone, plus bonuses for a rising trend,
              proven import source and a truly local player. The research bar: <strong>≥ 50,000 local visitors/month</strong>.
              Every store also gets the import-gate&apos;s <strong>dropship-verdict</strong> (shipping policy +
              brand signals) — big traffic does NOT mean it&apos;s a dropshipper. Pick a store to open its
              bestsellers{funnelType ? " for your chosen type" : ""}.
            </>
          }
        >
          {funnelType && (
            <div className="mb-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent/50 bg-[var(--accent-soft)] text-[12px] text-accent">
                Looking for: <strong>{funnelType.label}</strong>
                <button type="button" onClick={() => setFunnelType(null)} className="hover:text-text" title="Clear the chosen type">
                  ✕
                </button>
              </span>
            </div>
          )}

          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mb-4 text-[11.5px]">
            <label className="flex items-center gap-1.5 text-text-dim cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyEnough}
                onChange={(e) => setOnlyEnough(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              Only stores with enough local traffic (≥{((wtlStores?.min_local ?? 50000) / 1000).toFixed(0)}k/mo)
            </label>
            <span className="flex-1" />
            {wtlStores && wtlStores.traffic_missing > 0 && (
              <span className="text-text-faint">{wtlStores.traffic_missing} without traffic data yet</span>
            )}
            {wtlStores?.apify_configured && (
              <>
                <button
                  type="button"
                  onClick={() => void refreshTraffic()}
                  disabled={trafficRefreshing}
                  className="text-accent hover:underline disabled:opacity-50"
                  title="Fetch fresh SimilarWeb numbers for stores whose data is missing or older than a week (~1-3 min)"
                >
                  {trafficRefreshing ? "Updating traffic… (~2 min)" : "↻ Update traffic"}
                </button>
                <button
                  type="button"
                  onClick={() => void discoverStores()}
                  disabled={discovering}
                  className="text-accent hover:underline disabled:opacity-50"
                  title="Google-hunt for local fashion stores we DON'T know yet (the research scraper's method): localized searches → Shopify + locality + womens-fashion checks → market-size gate. Passers appear in this list. ~3-5 min."
                >
                  {discovering ? "Discovering… (~4 min)" : "🔍 Discover new stores"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void classifyStores()}
              disabled={classifying}
              className="text-accent hover:underline disabled:opacity-50"
              title="Run the import-gate check (shipping policy + brand signals) for stores that haven't been verified yet — the verdict chip appears on each card. Slow (~1 min per store), runs in the background."
            >
              {classifying
                ? "Verifying dropshippers…"
                : `🛡 Verify dropshippers${(wtlStores?.verdicts_missing ?? 0) > 0 ? ` (${wtlStores?.verdicts_missing})` : ""}`}
            </button>
            <a
              href={api.wtlExportUrl("stores", funnelMarket, { onlyOk: false })}
              className="text-accent hover:underline"
              title="Download the full ranked store list (score, exact local/total visits, trend) as a CSV for Excel / Google Sheets"
            >
              ⬇ Stores CSV
            </a>
            <a
              href={api.wtlExportUrl("products", funnelMarket, {
                category: funnelType?.category ?? undefined,
                onlyOk: onlyEnough,
              })}
              className="text-accent hover:underline"
              title={`Download the WORK LIST: every qualifying store × its bestsellers${funnelType ? ` (only ${funnelType.label})` : ""} — empty Status column, already-imported flags and product URLs. First download can take ~1 min.`}
            >
              ⬇ Work list CSV
            </a>
          </div>

          {discoverMsg && <p className="text-[11.5px] text-text-dim mb-3">{discoverMsg}</p>}

          {storesLoading ? (
            <p className="text-[12px] text-text-faint">Loading stores…</p>
          ) : !wtlStores || wtlStores.stores.length === 0 ? (
            <p className="text-[12px] text-text-faint">No known competitor stores yet — add one below.</p>
          ) : (
            (() => {
              const visible = wtlStores.stores.filter((s) => !onlyEnough || s.market_ok);
              if (visible.length === 0)
                return (
                  <p className="text-[12px] text-text-faint">
                    No stores clear the local-traffic bar
                    {wtlStores.traffic_missing > 0 ? " (some have no data yet — press “Update traffic”)" : ""} — untick
                    the filter to see all {wtlStores.stores.length}, or press “Discover new stores”.
                  </p>
                );
              const n = (v: number) => v.toLocaleString("en-US");
              const scoreTone = (sc: number) =>
                sc >= 60
                  ? "bg-green-600/15 text-green-600 dark:text-green-400 border-green-600/40"
                  : sc >= 30
                    ? "bg-amber-500/15 text-amber-500 border-amber-500/40"
                    : "bg-bg-elev text-text-faint border-border";
              const scoreWhy = (s: WtlStore) => {
                const p = s.score_parts ?? {};
                const bits = [`local traffic ${Math.round((p.local_traffic ?? 0) * 100)}`];
                if (p.trend) bits.push(`${p.trend > 0 ? "+" : ""}${Math.round(p.trend * 100)} trend`);
                if (p.proven_source) bits.push(`+${Math.round(p.proven_source * 100)} proven source`);
                if (p.local_player) bits.push(`+${Math.round(p.local_player * 100)} local player`);
                return `Score ${s.score}/100 = ${bits.join(" · ")}. Highest score = mine this store first.`;
              };
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {visible.map((s) => (
                    <button
                      key={s.domain}
                      type="button"
                      onClick={() => void runScan(s.domain, false, s)}
                      className="rounded-[12px] border border-border bg-bg-elev-2 px-4 py-3.5 text-left hover:border-accent transition group"
                      title={`Open ${s.domain}'s bestsellers (step 3)`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`shrink-0 px-2 py-0.5 rounded-md border text-[12px] font-bold tabular-nums ${scoreTone(s.score)}`}
                          title={scoreWhy(s)}
                        >
                          {s.score}
                        </span>
                        <span className="text-[13px] font-semibold text-text truncate group-hover:text-accent">
                          {s.domain.replace(/^www\./, "")}
                        </span>
                        <span className="flex-1" />
                        {s.has_traffic_data ? (
                          <span
                            className={`text-[11.5px] font-semibold tabular-nums ${
                              s.market_ok ? "text-green-600 dark:text-green-400" : "text-text-dim"
                            }`}
                            title={`Exactly ${n(s.local_visits)} visits/month from ${wtlStores.country} (${n(s.total_visits)} total × ${Math.round(s.local_share * 100)}% ${wtlStores.country}-share)`}
                          >
                            {n(s.local_visits)}/mo in {wtlStores.country}
                          </span>
                        ) : (
                          <span className="text-[11px] text-text-faint" title="SimilarWeb has no data (yet) — press “Update traffic”, or the store is too small">
                            no traffic data
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        {(() => {
                          const v = s.verdict;
                          const ali = v?.override === "ali-verified";
                          const warned = v && (v.label === "Eigen voorraad" || v.label === "Mogelijk eigen merk");
                          const cls = ali
                            ? "bg-green-600/15 text-green-600 dark:text-green-400 border-green-600/40"
                            : !v
                              ? "bg-bg-elev text-text-faint border-border"
                              : v.label === "Dropshipper"
                                ? "bg-green-600/15 text-green-600 dark:text-green-400 border-green-600/40"
                                : v.label === "Mogelijk eigen merk"
                                  ? "bg-amber-500/15 text-amber-500 border-amber-500/40"
                                  : v.label === "Eigen voorraad"
                                    ? "bg-danger/15 text-danger border-danger/40"
                                    : "bg-bg-elev text-text-dim border-border";
                          const txt = ali
                            ? "✓ source ok — on AliExpress"
                            : !v
                              ? "shipping not verified"
                              : v.label === "Dropshipper"
                                ? "✓ dropshipper"
                                : v.label === "Mogelijk eigen merk"
                                  ? "⚠ possible real brand"
                                  : v.label === "Eigen voorraad"
                                    ? "⚠ own stock — check AliExpress"
                                    : "? shipping unknown";
                          const overlap =
                            v && (v.overlap_matches ?? 0) > 0
                              ? ` Hint (NO proof): ${v.overlap_matches} of their bestsellers are also sold by other known stores — a typical supplier-catalog pattern. Still verify on AliExpress yourself (🔍 on a product card) before marking.`
                              : "";
                          return (
                            <>
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cls}`}
                                title={
                                  ali
                                    ? `Marked by an employee: products found on AliExpress, so this store is a usable source even with fast shipping (original verdict: ${v?.label ?? "?"}).${overlap}`
                                    : v
                                      ? `Import-gate verdict: ${v.label}${v.detail ? ` — ${v.detail}` : ""} (confidence: ${v.confidence}). Fast shipping alone doesn't disqualify a store — if you find its products on AliExpress, mark it OK.${overlap} Warn-only: you decide.`
                                      : "Not checked against its shipping policy yet — press “🛡 Verify dropshippers”. Warn-only: you decide."
                                }
                              >
                                {txt}
                              </span>
                              {(warned || ali) && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const next = ali ? null : ("ali-verified" as const);
                                    if (
                                      next &&
                                      !confirm(
                                        `Mark ${s.domain.replace(/^www\./, "")} as a VERIFIED source?\n\nOnly do this after actually finding their products on AliExpress.`
                                      )
                                    )
                                      return;
                                    void api
                                      .wtlStoreOverride(s.domain, next)
                                      .then(() => api.wtlStores(funnelMarket))
                                      .then(setWtlStores)
                                      .catch(() => {});
                                  }}
                                  onKeyDown={(e) => e.stopPropagation()}
                                  className="text-[10px] text-accent hover:underline cursor-pointer"
                                  title={
                                    ali
                                      ? "Remove the AliExpress-verified mark"
                                      : "Found their products on AliExpress? Click to mark this store as a usable source (remembered for everyone)."
                                  }
                                >
                                  {ali ? "unmark" : "found on AliExpress →"}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      <div className="text-[10.5px] text-text-faint mt-1 tabular-nums">
                        {s.has_traffic_data && <>total {n(s.total_visits)}/mo · {Math.round(s.local_share * 100)}% local</>}
                        {s.trend_pct !== null && s.trend_pct !== undefined && (
                          <span
                            className={
                              s.trend_pct >= 15
                                ? " text-green-600 dark:text-green-400"
                                : s.trend_pct <= -15
                                  ? " text-danger"
                                  : ""
                            }
                            title="Total visits vs the previous month"
                          >
                            {" "}· {s.trend_pct >= 0 ? "↑ +" : "↓ "}{s.trend_pct}% m/m
                          </span>
                        )}
                        {s.has_traffic_data && " · "}
                        {s.products > 0 ? `${s.products} imported before` : "never imported"}
                        {s.last_import ? ` · last ${s.last_import}` : ""}
                        <span className="text-accent opacity-0 group-hover:opacity-100"> · View bestsellers →</span>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()
          )}

          <div className="flex items-center gap-2 mt-5 max-w-xl">
            <input
              type="text"
              value={addDomain}
              onChange={(e) => setAddDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addStore();
              }}
              placeholder="Add a store… e.g. maisonelorie.fr"
              className="flex-1 px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[12px] focus:outline-none focus:border-accent"
            />
            <Button variant="secondary" size="sm" onClick={() => void addStore()} disabled={!addDomain.trim()}>
              + Add
            </Button>
          </div>
          {addMsg && <p className="text-[11.5px] mt-2 text-text-dim">{addMsg}</p>}
        </Section>

        {/* ③ Products */}
        <Section
          id="step-products"
          step="③"
          title="Products — competitor bestsellers"
          intro={
            <>
              Pick a store above (or type any competitor domain) and it reads their <strong>best-selling</strong> page:
              their current winners in sales order. <strong>Import →</strong> opens the dashboard&apos;s import screen
              prefilled — the normal checks (shipping, brand, price) still run there.
            </>
          }
        >
          <div className="flex items-center gap-2 flex-wrap mb-4 max-w-3xl">
            <input
              type="text"
              value={competitorDomain}
              onChange={(e) => setCompetitorDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runScan();
              }}
              placeholder="e.g. noirlndn.com"
              className="flex-1 min-w-[220px] px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[12px] focus:outline-none focus:border-accent"
            />
            <Button variant="primary" size="sm" onClick={() => void runScan()} disabled={!competitorDomain.trim() || scanning}>
              {scanning ? "Scanning…" : "Scan"}
            </Button>
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
            {scan && scan.ok && (
              <a
                href={api.wtlExportUrl("bestsellers", funnelMarket, { domain: scan.domain })}
                className="text-[12px] px-3 h-9 inline-flex items-center rounded-[10px] border border-accent text-accent hover:bg-[var(--accent-soft)] transition"
                title="Download this store's full bestseller list as a CSV (position, title, type, price, already-imported, URL) — same format as the stores export"
              >
                ⬇ Bestsellers CSV
              </a>
            )}
          </div>

          {scanning && <p className="text-[12px] text-text-faint">Reading their bestseller page… (~5–10s)</p>}

          {!scan && !scanning && (
            <p className="text-[12px] text-text-faint">
              No store scanned yet — pick one in step ② or type a domain above.
            </p>
          )}

          {scan && !scanning && !scan.ok && (
            <div className="rounded-[12px] border border-warning/40 bg-warning/10 px-4 py-3 text-[12px] text-text max-w-3xl">
              ⚠ Can&apos;t scan this store: {scan.blocked ?? scan.error ?? "unknown error"}.
              {bestsellerUrl && (
                <>
                  {" "}Try <a className="text-accent hover:underline" href={bestsellerUrl} target="_blank" rel="noopener noreferrer">opening it in your browser ↗</a> instead.
                </>
              )}
            </div>
          )}

          {scan && !scanning && scan.ok && (
            <div className="space-y-4">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[12.5px] text-text">
                  <strong>{scan.domain?.replace(/^www\./, "")}</strong> — top {scan.count}:{" "}
                  <strong>
                    {Object.entries(scan.by_category ?? {})
                      .map(([c, cnt]) => `${cnt}× ${c}`)
                      .join(" · ")}
                  </strong>
                </span>
                <span className="text-[11px] text-text-faint">
                  {scan.from_cache ? `saved ${Math.round((scan.cache_age_seconds ?? 0) / 3600)}h ago ·` : ""}
                </span>
                <button type="button" onClick={() => void runScan(undefined, true)} className="text-[11px] text-accent hover:underline">
                  ↻ Rescan
                </button>
              </div>

              {recommended.length > 0 && (
                <p className="text-[11.5px] text-text-dim leading-relaxed max-w-3xl">
                  Vs your recommendation:{" "}
                  {recommended.slice(0, 3).map((t, i) => {
                    const cnt = (scan.by_category ?? {})[t.category ?? ""] ?? 0;
                    return (
                      <span key={t.seed}>
                        {i > 0 && " · "}
                        <strong>{t.label}</strong>:{" "}
                        {cnt > 0 ? (
                          <span className="text-green-600 dark:text-green-400">{cnt} in their top {scan.count} ✓</span>
                        ) : (
                          <span className="text-text-faint">none in their top {scan.count}</span>
                        )}
                      </span>
                    );
                  })}
                </p>
              )}

              {(() => {
                const all = scan.products ?? [];
                const typeCat = funnelType?.category ?? null;
                const matching = typeCat ? all.filter((p) => p.category === typeCat) : all;
                const products = onlyType && typeCat ? matching : all;
                const imported = new Set(scanStore?.imported_handles ?? []);
                return (
                  <>
                    {typeCat && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setOnlyType(true)}
                          className={`px-3 h-8 rounded-full text-[11.5px] border transition ${
                            onlyType ? "border-accent text-accent bg-[var(--accent-soft)]" : "border-border text-text-dim"
                          }`}
                        >
                          Only {funnelType?.label} ({matching.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setOnlyType(false)}
                          className={`px-3 h-8 rounded-full text-[11.5px] border transition ${
                            !onlyType ? "border-accent text-accent bg-[var(--accent-soft)]" : "border-border text-text-dim"
                          }`}
                        >
                          All types ({all.length})
                        </button>
                      </div>
                    )}
                    {products.length === 0 ? (
                      <p className="text-[12px] text-text-faint">
                        No {funnelType?.label} in their top {scan.count} — try another store, or show all types.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                        {products.map((p) => {
                          const done = imported.has(p.handle);
                          return (
                            <div
                              key={p.handle}
                              className={`rounded-[12px] border bg-bg-elev-2 overflow-hidden transition group relative ${
                                done ? "border-border opacity-60" : "border-border hover:border-accent"
                              }`}
                            >
                              {done && (
                                <span className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bg-elev text-text-dim border border-border">
                                  ✓ already imported
                                </span>
                              )}
                              {p.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.image} alt="" className="w-full h-36 object-cover" loading="lazy" />
                              ) : (
                                <div className="w-full h-36 bg-bg-elev" />
                              )}
                              <div className="px-2.5 py-2">
                                <div className="text-[11.5px] text-text truncate" title={p.title}>
                                  <span className="text-text-faint">#{p.position}</span> {p.title}
                                </div>
                                <div className="text-[10.5px] text-text-faint">
                                  {p.category}
                                  {p.published_at ? ` · since ${p.published_at}` : ""}
                                </div>
                                {(p.price_ok === false || (p.also_at?.length ?? 0) > 0) && (
                                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                    {p.price_ok === false && (
                                      <span
                                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/40"
                                        title={`≈ €${p.price_eur ?? "?"} — under the €25 minimum (too little margin)`}
                                      >
                                        &lt; €25
                                      </span>
                                    )}
                                    {(p.also_at?.length ?? 0) > 0 && (
                                      <span
                                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-600/15 text-green-600 dark:text-green-400 border border-green-600/40"
                                        title={`Also a bestseller at: ${(p.also_at ?? []).join(", ")} — multiple stores pushing the same product is a strong winner signal`}
                                      >
                                        🔥 also at {p.also_at?.length}
                                      </span>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-1 mt-2">
                                  <button
                                    type="button"
                                    onClick={() => importProduct(p.url)}
                                    disabled={done}
                                    className="flex-1 h-8 rounded-[8px] bg-accent text-on-accent text-[11.5px] font-semibold hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Open the dashboard's import screen with this product's URL prefilled"
                                  >
                                    Import →
                                  </button>
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="h-8 px-2.5 inline-flex items-center rounded-[8px] border border-border text-[11.5px] text-text-dim hover:border-accent hover:text-accent"
                                    title="Open the product on the competitor's site"
                                  >
                                    ↗
                                  </a>
                                  {p.image && (
                                    <a
                                      href={`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(p.image)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="h-8 px-2.5 inline-flex items-center rounded-[8px] border border-border text-[11.5px] text-text-dim hover:border-accent hover:text-accent"
                                      title="Quick AliExpress check: opens this photo in Google Lens — if AliExpress/1688 listings show up in the matches, the product is supplier-catalog (then mark the store 'found on AliExpress' in step ②). The system can't verify this automatically; you look, you decide."
                                    >
                                      🔍
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
