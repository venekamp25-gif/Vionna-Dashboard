"use client";

import { useEffect, useState } from "react";
import { StoreKey, STORE_CONFIG } from "@/lib/store";
import { Button } from "@/components/ui/Button";

export type ReviewKw = {
  keyword: string;
  volume: number | null;
  intent: string | null;
  recommended: boolean;
  source: "manual" | "research" | "custom";
  seasonality?: {
    peak_month?: string;
    trough_month?: string;
    push_from_month?: string;
    trend?: string;
    seasonal?: boolean;
  } | null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function inSeasonNow(k: ReviewKw): boolean {
  const s = k.seasonality;
  if (!s?.seasonal) return false;
  const push = s.push_from_month ? MONTHS.indexOf(s.push_from_month) + 1 : 0;
  const peak = s.peak_month ? MONTHS.indexOf(s.peak_month) + 1 : 0;
  if (!push || !peak) return false;
  const now = new Date().getMonth() + 1;
  return push <= peak ? now >= push && now <= peak : now >= push || now <= peak;
}

function seasonText(k: ReviewKw): string {
  const s = k.seasonality;
  if (s?.seasonal && s.peak_month) return `peak ${s.peak_month} → start ${s.push_from_month}`;
  if (s?.trend && s.trend !== "flat") return s.trend === "rising" ? "↑ rising" : "↓ falling";
  return "";
}

/**
 * Import-time keyword review. After scraping + auto-research, the worker sees
 * the recommended keywords per market (pre-ticked) and can add/remove before any
 * copy is generated — so nothing is written from keywords they didn't approve.
 */
export function KeywordReviewModal({
  open,
  stores,
  byStore,
  productName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  stores: StoreKey[];
  byStore: Partial<Record<StoreKey, ReviewKw[]>>;
  productName: string;
  onCancel: () => void;
  onConfirm: (selectedByStore: Partial<Record<StoreKey, string[]>>) => void;
}) {
  const [rows, setRows] = useState<Partial<Record<StoreKey, ReviewKw[]>>>({});
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [viewStore, setViewStore] = useState<StoreKey>(stores[0] ?? "dk");
  const [addText, setAddText] = useState("");

  // Seed the editable copy + pre-tick recommended / manual keywords whenever the
  // modal opens for a fresh product.
  useEffect(() => {
    if (!open) return;
    const initRows: Partial<Record<StoreKey, ReviewKw[]>> = {};
    const initSel: Record<string, boolean> = {};
    stores.forEach((s) => {
      const list = byStore[s] ?? [];
      initRows[s] = list;
      // If the worker typed keywords for this store on the import screen, keep
      // ONLY those pre-selected — never silently overwrite or add to their work.
      // The researched keywords still show below as OPTIONAL extras (unticked).
      // If they left it empty, pre-tick the recommended research keywords.
      const hasManual = list.some((k) => k.source === "manual");
      list.forEach((k) => {
        const pick = hasManual ? k.source === "manual" : k.recommended;
        if (pick) initSel[`${s}:${k.keyword}`] = true;
      });
    });
    setRows(initRows);
    setSel(initSel);
    setViewStore(stores[0] ?? "dk");
    setAddText("");
  }, [open, byStore, stores]);

  if (!open) return null;

  const key = (s: StoreKey, kw: string) => `${s}:${kw}`;
  const viewRows = rows[viewStore] ?? [];
  const selectedCount = (s: StoreKey) => (rows[s] ?? []).filter((k) => sel[key(s, k.keyword)]).length;

  const toggle = (kw: string) =>
    setSel((p) => ({ ...p, [key(viewStore, kw)]: !p[key(viewStore, kw)] }));

  const addKeyword = () => {
    const kw = addText.trim();
    if (!kw) return;
    const exists = (rows[viewStore] ?? []).some((k) => k.keyword.toLowerCase() === kw.toLowerCase());
    if (!exists) {
      setRows((p) => ({
        ...p,
        [viewStore]: [
          ...(p[viewStore] ?? []),
          { keyword: kw, volume: null, intent: null, recommended: false, source: "custom" as const, seasonality: null },
        ],
      }));
    }
    setSel((p) => ({ ...p, [key(viewStore, kw)]: true }));
    setAddText("");
  };

  const confirm = () => {
    const out: Partial<Record<StoreKey, string[]>> = {};
    stores.forEach((s) => {
      out[s] = (rows[s] ?? []).filter((k) => sel[key(s, k.keyword)]).map((k) => k.keyword);
    });
    onConfirm(out);
  };

  const totalSelected = stores.reduce((n, s) => n + selectedCount(s), 0);

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-elev border border-border rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-[16px] font-semibold text-text">Review keywords</h2>
          <p className="text-[12px] text-text-faint mt-0.5 leading-relaxed">
            Before the product text is written, check the keywords it will be built from for{" "}
            <strong className="text-text-dim">{productName}</strong>. Tick the ones to use, untick the rest, or add
            your own. <span className="text-amber-500">★</span> = recommended (already ticked). Nothing is written
            until you press <strong>Generate copy</strong>.
          </p>
        </div>

        {/* Store tabs */}
        {stores.length > 1 && (
          <div className="flex items-center gap-1 px-6 border-b border-border shrink-0">
            {stores.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setViewStore(s)}
                className={`px-3 py-2 text-[12px] -mb-px border-b-2 transition ${
                  viewStore === s ? "border-accent text-accent" : "border-transparent text-text-dim hover:text-text"
                }`}
              >
                {STORE_CONFIG[s].label}
                <span className="text-text-faint ml-1">({selectedCount(s)})</span>
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {viewRows.some((k) => k.source === "manual") && (
            <div className="text-[11px] text-accent bg-[var(--accent-soft)] rounded-[8px] px-3 py-2 mb-3 leading-relaxed">
              ✓ Your own keywords for {STORE_CONFIG[viewStore].label} are marked <em>(yours)</em> and kept ticked —
              the researched ones below are optional extras you can add if you want.
            </div>
          )}
          {viewRows.length === 0 ? (
            <p className="text-[13px] text-text-faint">
              No keywords found for {STORE_CONFIG[viewStore].label}. Add one or two below, or just continue — the
              product text will still be written, it just won&apos;t be guided by any keywords.
            </p>
          ) : (
            <table className="w-full text-[12px] border-collapse">
              <colgroup>
                <col className="w-[30px]" />
                <col />
                <col className="w-[90px]" />
                <col className="w-[150px]" />
              </colgroup>
              <thead>
                <tr className="text-text-faint text-left border-b border-border">
                  <th className="py-2" />
                  <th className="py-2 pr-3 font-medium">Keyword</th>
                  <th className="py-2 px-2 font-medium text-right">Volume/mo</th>
                  <th className="py-2 px-2 font-medium">Season</th>
                </tr>
              </thead>
              <tbody>
                {viewRows.map((k, i) => {
                  const checked = !!sel[key(viewStore, k.keyword)];
                  const hot = inSeasonNow(k);
                  return (
                    <tr key={i} className={`border-b border-border/60 ${hot ? "bg-green-500/[0.08]" : ""}`}>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(k.keyword)}
                          className="align-middle accent-[var(--accent)] cursor-pointer"
                          aria-label={`Use ${k.keyword}`}
                        />
                      </td>
                      <td className={`py-2 pr-3 ${hot ? "text-green-600 dark:text-green-400 font-medium" : "text-text"}`}>
                        {k.recommended && (
                          <span className="mr-1 text-amber-500" title="Recommended">
                            ★
                          </span>
                        )}
                        {k.keyword}
                        {k.source === "manual" && (
                          <span className="ml-1.5 text-[10px] text-text-faint">(yours)</span>
                        )}
                        {k.source === "custom" && (
                          <span className="ml-1.5 text-[10px] text-accent">(added)</span>
                        )}
                        {hot && <span className="ml-1.5 text-[10px] text-green-600 dark:text-green-400">● in season</span>}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap text-text-dim">
                        {k.volume != null ? k.volume.toLocaleString("en-US") : "—"}
                      </td>
                      <td className="py-2 px-2 text-text-dim whitespace-nowrap">{seasonText(k) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Add custom keyword */}
          <div className="flex items-center gap-2 mt-4">
            <input
              type="text"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder={`Add a keyword for ${STORE_CONFIG[viewStore].label}…`}
              className="flex-1 px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[12px] focus:outline-none focus:border-accent"
            />
            <Button variant="secondary" size="sm" onClick={addKeyword} disabled={!addText.trim()}>
              + Add
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
          <span className="text-[12px] text-text-faint">
            {totalSelected} keyword{totalSelected === 1 ? "" : "s"} selected across{" "}
            {stores.length === 1 ? STORE_CONFIG[stores[0]].label : `${stores.length} markets`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              ← Back to input
            </Button>
            <Button variant="primary" size="sm" onClick={confirm}>
              Generate copy →
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
