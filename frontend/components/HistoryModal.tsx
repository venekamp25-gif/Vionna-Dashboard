"use client";

import { useEffect, useMemo, useState } from "react";
import { api, HistoryEntry, ProductSnapshotMeta } from "@/lib/api";
import { StoreKey, STORE_CONFIG, STORE_KEYS, useStore } from "@/lib/store";
import { useProduct, listProductSnapshots, loadProductSnapshot } from "@/lib/product";
import { useStep } from "@/lib/step";

interface Props {
  open: boolean;
  onClose: () => void;
}

type StoreFilter = "all" | StoreKey;

/**
 * Browse the publish-history log (every variant the dashboard has created).
 *
 * Each entry comes from /api/history; the backend writes one entry per variant
 * to publish_history.jsonl. We group consecutive entries that share product
 * name + timestamp-minute into a single "publish event" so you see one card
 * per imported product instead of one row per colour duplicate.
 */
export function HistoryModal({ open, onClose }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<StoreFilter>("all");
  const [search, setSearch] = useState("");

  // ── Re-openable product snapshots (full saved state of recent publishes) ──
  const { setData } = useProduct();
  const { setStore } = useStore();
  const { setStep } = useStep();
  const [snapshots, setSnapshots] = useState<ProductSnapshotMeta[]>([]);
  const [reopening, setReopening] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listProductSnapshots().then(setSnapshots).catch(() => setSnapshots([]));
  }, [open]);

  const reopen = async (id: string) => {
    setReopening(id);
    try {
      const snap = await loadProductSnapshot(id);
      if (!snap) return;
      setData(snap);
      setStore(snap.activeViewStore);
      onClose();
      setStep(3); // land on Review so the user can edit / re-publish
    } finally {
      setReopening(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    api
      .history({ limit: 500 })
      .then((r) => {
        if (r.error) throw new Error(r.error);
        setEntries(r.entries ?? []);
        setTotal(r.total ?? 0);
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [open]);

  const grouped = useMemo(() => groupByPublishEvent(entries), [entries]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return grouped.filter((g) => {
      if (storeFilter !== "all" && g.store !== storeFilter) return false;
      if (q && !g.product_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [grouped, storeFilter, search]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-16 px-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-bg-elev border border-border rounded-2xl shadow-2xl mb-16"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-[16px] font-semibold text-text">Publish history</h2>
            <p className="text-[11px] text-text-faint mt-0.5">
              {total} variant{total === 1 ? "" : "s"} created · grouped into {grouped.length} publish event{grouped.length === 1 ? "" : "s"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-text-faint hover:text-text text-xl px-2">
            ✕
          </button>
        </div>

        <div className="px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="inline-flex bg-bg-elev-2 rounded-lg p-[3px] gap-[2px]">
            {(["all", ...STORE_KEYS] as StoreFilter[]).map((s) => {
              const active = s === storeFilter;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStoreFilter(s)}
                  className={[
                    "px-3 py-1 rounded-md text-[11px] font-medium uppercase tracking-wider transition-all",
                    active ? "bg-accent text-on-accent shadow-sm" : "text-text-dim hover:text-text",
                  ].join(" ")}
                >
                  {s === "all" ? "All" : STORE_CONFIG[s as StoreKey].label.replace("Store ", "")}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product name…"
            className="flex-1 min-w-[200px] bg-bg-elev-2 border border-border rounded-md px-3 py-1.5 text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
        </div>

        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {snapshots.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-text-dim uppercase tracking-wider mb-2">
                ↩ Reopen a recent product
              </h3>
              <div className="space-y-1.5">
                {snapshots.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-[10px] bg-bg-elev-2 border border-border"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text truncate">{s.name}</div>
                      <div className="text-[11px] text-text-faint">
                        {(s.stores ?? []).map((x) => x.toUpperCase()).join(" · ") || "—"} ·{" "}
                        {s.color_count} colour{s.color_count === 1 ? "" : "s"} ·{" "}
                        {new Date(s.saved_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void reopen(s.id)}
                      disabled={reopening !== null}
                      className="text-[12px] font-semibold px-3 py-1.5 rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50 whitespace-nowrap"
                    >
                      {reopening === s.id ? "Opening…" : "↩ Reopen"}
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-b border-border mt-4" />
            </div>
          )}
          {loading ? (
            <p className="text-[13px] text-text-faint text-center py-8">Loading…</p>
          ) : error ? (
            <p className="text-[13px] text-danger text-center py-8">Could not load history: {error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-[13px] text-text-faint text-center py-8">
              {entries.length === 0
                ? "No publishes yet."
                : "No publishes match your filter."}
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((g) => (
                <EventCard key={g.id} group={g} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface PublishEvent {
  id: string;
  store: StoreKey;
  product_name: string;
  timestamp: string;
  colors: string[];
  product_urls: string[];
  collection_handle?: string | null;
  source_url?: string | null;
  variant_count: number;
  total_metafield_errors: number;
}

function groupByPublishEvent(entries: HistoryEntry[]): PublishEvent[] {
  // Group consecutive entries that share product + store + same minute-bucket.
  // The publish loop creates colour duplicates in quick succession, so grouping
  // by minute groups them into one event while still separating distinct runs
  // (e.g. DK run vs FR run vs a retry an hour later).
  const out: PublishEvent[] = [];
  const seenKeys = new Map<string, PublishEvent>();
  for (const e of entries) {
    const minute = e.timestamp.slice(0, 16); // YYYY-MM-DDTHH:MM
    const key = `${e.store}|${e.product_name}|${minute}`;
    let g = seenKeys.get(key);
    if (!g) {
      g = {
        id: key,
        store: e.store,
        product_name: e.product_name,
        timestamp: e.timestamp,
        colors: [],
        product_urls: [],
        collection_handle: e.collection_handle ?? null,
        source_url: e.source_url ?? null,
        variant_count: 0,
        total_metafield_errors: 0,
      };
      seenKeys.set(key, g);
      out.push(g);
    }
    if (!g.source_url && e.source_url) g.source_url = e.source_url;
    if (e.color && !g.colors.includes(e.color)) g.colors.push(e.color);
    if (e.product_url) g.product_urls.push(e.product_url);
    g.variant_count += 1;
    g.total_metafield_errors += (e.metafield_errors?.length ?? 0);
  }
  return out;
}

function EventCard({ group: g }: { group: PublishEvent }) {
  return (
    <div className="px-3.5 py-3 rounded-[10px] bg-bg-elev-2 border border-border">
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-bg-elev text-text-dim">
          {STORE_CONFIG[g.store].label}
        </span>
        <span className="text-[13px] font-semibold text-text">{g.product_name}</span>
        <span className="text-[10px] text-text-faint">{formatTimestamp(g.timestamp)}</span>
        <span className="ml-auto text-[10px] text-text-faint">
          {g.variant_count} {g.variant_count === 1 ? "variant" : "variants"}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 pl-1">
        {g.colors.map((c, i) =>
          g.product_urls[i] ? (
            <a
              key={c}
              href={g.product_urls[i]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-accent hover:text-accent-hover hover:underline"
            >
              {c}
            </a>
          ) : (
            <span key={c} className="text-[12px] text-text-dim">{c}</span>
          )
        )}
      </div>
      {g.source_url && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-faint pl-1 min-w-0">
          <span className="shrink-0">🔗 Imported from</span>
          <a
            href={g.source_url}
            target="_blank"
            rel="noopener noreferrer"
            title={g.source_url}
            className="text-text-dim hover:text-accent hover:underline truncate"
          >
            {sourceLabel(g.source_url)}
          </a>
        </div>
      )}
      {g.total_metafield_errors > 0 && (
        <div className="mt-1.5 text-[11px] text-warning">
          ⚠ {g.total_metafield_errors} metafield {g.total_metafield_errors === 1 ? "error" : "errors"} during this publish
        </div>
      )}
    </div>
  );
}

/** Just the store/brand name from a competitor URL — the link itself still points
 *  at the EXACT product page. e.g. https://www.noirlndn.com/products/x → "Noirlndn". */
function sourceLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    // handle two-level TLDs (co.uk, com.au, …) so we pick the brand label
    const twoLevel = new Set(["co", "com", "org", "net", "gov", "ac"]);
    const name =
      parts.length >= 3 && twoLevel.has(parts[parts.length - 2])
        ? parts[parts.length - 3]
        : parts.length >= 2
          ? parts[parts.length - 2]
          : parts[0];
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : host;
  } catch {
    return url;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
