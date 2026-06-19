"use client";

import { useEffect, useMemo, useState } from "react";
import { api, BackfillGroup } from "@/lib/api";
import { StoreKey, STORE_CONFIG, STORE_KEYS, useStore } from "@/lib/store";
import { createLimiter } from "@/lib/concurrency";
import { loadToneReferences } from "@/lib/toneReference";
import { notify } from "@/lib/notifications";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

interface Props {
  open: boolean;
  onClose: () => void;
}

type RowStatus = "todo" | "generating" | "generated" | "saving" | "saved" | "error";

interface RowState {
  keywords: string;
  status: RowStatus;
  gen: { description: string; meta_description: string; m_title_specs: string };
  err?: string;
}

const EMPTY_GEN = { description: "", meta_description: "", m_title_specs: "" };

/** Split a comma/newline-separated keyword field into a clean list. */
function parseKeywords(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize a product name for fuzzy matching: strip diacritics, lowercase,
 *  drop punctuation, collapse whitespace. "Solène FR" -> "solene fr". */
function normalizeName(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface ParsedKeywordRow {
  name: string;
  keywords: string;
}

/** Parse a pasted keyword list into {name, keywords} rows. Accepts a tab-
 *  separated paste straight from Google Sheets (first column = product name,
 *  the rest = keywords), plus "name | keywords" and "name: keywords". A leading
 *  header row ("product", "keywords", …) is detected and skipped. */
function parseKeywordList(text: string): ParsedKeywordRow[] {
  const out: ParsedKeywordRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parts: string[] | null = null;
    if (line.includes("\t")) parts = line.split("\t");
    else if (line.includes("|")) parts = line.split("|");
    else {
      const m = line.match(/^([^:]+):\s*(.+)$/);
      if (m) parts = [m[1], m[2]];
    }
    if (!parts) continue;
    parts = parts.map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue; // need a name + at least one keyword
    out.push({ name: parts[0], keywords: parts.slice(1).join(", ") });
  }
  // Drop a header row like "Product<TAB>Keywords".
  if (out.length) {
    const hn = out[0].name.toLowerCase();
    if (
      ["product", "products", "productnaam", "naam", "name", "jurk", "dress", "item"].includes(hn) ||
      /keyword|trefwoord|zoekwoord/i.test(out[0].keywords)
    ) {
      out.shift();
    }
  }
  return out;
}

interface PasteResult {
  matched: number;
  fuzzy: number;
  ambiguous: { name: string; candidates: string[] }[];
  unmatched: string[];
}

/**
 * Keyword backfill — regenerate copy for products that were imported BEFORE
 * keyword research was done (e.g. FI, which goes live without per-product
 * keywords). Loads every active product grouped per dress, you paste the
 * keywords your team researched, regenerate via the SAME /api/generate as the
 * import wizard, review old-vs-new, and push to Shopify. Copy is written to
 * every colour-product of the dress at once.
 */
export function KeywordBackfillModal({ open, onClose }: Props) {
  const { store: globalStore } = useStore();
  const [store, setStore] = useState<StoreKey>(globalStore);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<BackfillGroup[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [search, setSearch] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteResult, setPasteResult] = useState<PasteResult | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const load = async (s: StoreKey, drafts: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.backfillProducts(s, drafts);
      if (r.error) throw new Error(r.error);
      const gs = r.groups ?? [];
      setGroups(gs);
      setRows(
        Object.fromEntries(
          gs.map((g) => [g.key, { keywords: "", status: "todo" as RowStatus, gen: { ...EMPTY_GEN } }])
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGroups([]);
      setRows({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load(store, includeDrafts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, store, includeDrafts]);

  const patchRow = (key: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  // In-app confirmation popup — always visible (the desktop notification is
  // suppressed by the browser while the tab is focused, so Omar would otherwise
  // see nothing while working in the modal).
  const showToast = (kind: "ok" | "err", msg: string) => setToast({ kind, msg });
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const generateRow = async (g: BackfillGroup): Promise<boolean> => {
    const row = rows[g.key];
    const kws = parseKeywords(row?.keywords ?? "");
    if (kws.length === 0) {
      patchRow(g.key, { status: "error", err: "Enter keywords first." });
      return false;
    }
    patchRow(g.key, { status: "generating", err: undefined });
    try {
      const gen = await api.generate({
        store,
        product_name: g.product_name,
        product_title: g.product_name,
        keywords: kws,
        tone_references: loadToneReferences()[store],
      });
      if (gen.error) throw new Error(gen.error);
      patchRow(g.key, {
        status: "generated",
        gen: {
          description: gen.description ?? "",
          meta_description: gen.meta_description ?? "",
          m_title_specs: gen.m_title_specs ?? "",
        },
      });
      return true;
    } catch (e) {
      patchRow(g.key, { status: "error", err: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const saveRow = async (g: BackfillGroup, quiet = false): Promise<boolean> => {
    const row = rows[g.key];
    if (!row || !row.gen.description) return false;
    patchRow(g.key, { status: "saving", err: undefined });
    try {
      const r = await api.backfillApply({
        store,
        product_ids: g.product_ids,
        description: row.gen.description,
        meta_description: row.gen.meta_description,
        m_title_specs: row.gen.m_title_specs,
      });
      if (r.error) throw new Error(r.error);
      if (r.failed > 0) {
        const firstErr = r.results.find((x) => !x.ok)?.errors?.[0] ?? "unknown error";
        throw new Error(`${r.failed}/${r.results.length} products failed: ${firstErr}`);
      }
      patchRow(g.key, { status: "saved" });
      if (!quiet) {
        showToast("ok", `✓ ${g.product_name} saved to Shopify — ${r.applied} colour-product${r.applied === 1 ? "" : "s"} updated`);
        notify(`${g.product_name} updated`, `${r.applied} product(s) saved to Shopify ${store.toUpperCase()}.`, "backfill-saved");
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patchRow(g.key, { status: "error", err: msg });
      if (!quiet) showToast("err", `${g.product_name}: ${msg}`);
      return false;
    }
  };

  // Restore the exact previous body + SEO metafields for a dress (raw HTML, so
  // formatting is preserved 1:1 — not re-derived from text).
  const revertRow = async (g: BackfillGroup) => {
    patchRow(g.key, { status: "saving", err: undefined });
    try {
      const r = await api.backfillApply({
        store,
        product_ids: g.product_ids,
        description_html: g.current.description_html,
        meta_description: g.current.meta_description,
        m_title_specs: g.current.m_title_specs,
        set_handled: false, // reverting un-marks it → reappears in the default view
      });
      if (r.error) throw new Error(r.error);
      patchRow(g.key, { status: "generated" });
      showToast("ok", `↶ ${g.product_name} reverted to the original text`);
      notify(`${g.product_name} reverted`, "The original text has been restored.", "backfill-revert");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patchRow(g.key, { status: "error", err: msg });
      showToast("err", `${g.product_name}: ${msg}`);
    }
  };

  const runBulk = async (which: "generate" | "save") => {
    setBulkBusy(true);
    const lim = createLimiter(4);
    const targets = groups.filter((g) => {
      const r = rows[g.key];
      if (!r) return false;
      if (which === "generate") return parseKeywords(r.keywords).length > 0 && (r.status === "todo" || r.status === "error");
      return r.status === "generated";
    });
    // quiet=true so each row doesn't fire its own toast — show ONE summary instead.
    const oks = await Promise.all(
      targets.map((g) => lim.run(() => (which === "generate" ? generateRow(g) : saveRow(g, true))))
    );
    setBulkBusy(false);
    const n = oks.filter(Boolean).length;
    if (targets.length > 0) {
      showToast(
        n === targets.length ? "ok" : "err",
        which === "save"
          ? `✓ Saved ${n}/${targets.length} product${targets.length === 1 ? "" : "s"} to Shopify`
          : `✨ Generated ${n}/${targets.length} product${targets.length === 1 ? "" : "s"}`
      );
    }
  };

  // Auto-fill keyword fields from a pasted list (Google Sheets / "name | kw")
  // by matching each row to a dress on its product name. Exact (normalized)
  // match first, then a single-candidate "contains" fuzzy fallback.
  const applyPaste = () => {
    const parsed = parseKeywordList(pasteText);
    const byNorm = new Map<string, BackfillGroup[]>();
    for (const g of groups) {
      const k = normalizeName(g.product_name);
      if (!k) continue;
      const arr = byNorm.get(k);
      if (arr) arr.push(g);
      else byNorm.set(k, [g]);
    }

    const fills: Record<string, string> = {};
    const res: PasteResult = { matched: 0, fuzzy: 0, ambiguous: [], unmatched: [] };
    for (const row of parsed) {
      const n = normalizeName(row.name);
      if (!n) continue;
      let cands = byNorm.get(n) ?? [];
      let isFuzzy = false;
      if (cands.length === 0) {
        cands = groups.filter((g) => {
          const gn = normalizeName(g.product_name);
          return gn.length >= 3 && n.length >= 3 && (gn.includes(n) || n.includes(gn));
        });
        isFuzzy = true;
      }
      if (cands.length === 1) {
        fills[cands[0].key] = row.keywords;
        if (isFuzzy) res.fuzzy += 1;
        else res.matched += 1;
      } else if (cands.length > 1) {
        res.ambiguous.push({ name: row.name, candidates: cands.map((c) => c.product_name) });
      } else {
        res.unmatched.push(row.name);
      }
    }

    setRows((prev) => {
      const next = { ...prev };
      for (const [key, kw] of Object.entries(fills)) {
        // keywords changed → reset to "todo" + clear any stale generated copy
        next[key] = { keywords: kw, status: "todo", gen: { ...EMPTY_GEN } };
      }
      return next;
    });
    setPasteResult(res);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (!showDone && g.handled) return false; // hide already-done by default
      if (q && !g.product_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [groups, search, showDone]);

  const counts = useMemo(() => {
    const vals = Object.values(rows);
    return {
      products: groups.length,
      done: groups.filter((g) => g.handled).length,
      withKeywords: vals.filter((r) => parseKeywords(r.keywords).length > 0).length,
      generated: vals.filter((r) => r.status === "generated" || r.status === "saving").length,
      saved: vals.filter((r) => r.status === "saved").length,
    };
  }, [rows, groups]);

  if (!open) return null;

  return (
    <>
      {toast && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-lg shadow-2xl text-[13px] font-medium ${
            toast.kind === "ok" ? "bg-accent text-on-accent" : "bg-danger text-white"
          }`}
          role="status"
        >
          {toast.msg}
        </div>
      )}
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-12 px-4 overflow-y-auto"
        onClick={onClose}
      >
      <div
        className="w-full max-w-6xl bg-bg-elev border border-border rounded-2xl shadow-2xl mb-12"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-[16px] font-semibold text-text">🔑 Keyword backfill</h2>
            <p className="text-[11px] text-text-faint mt-0.5">
              {filtered.length} shown · {counts.done} already done · {counts.saved} saved this session · regenerates description + meta + m_title_specs
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-text-faint hover:text-text text-xl px-2">
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="inline-flex bg-bg-elev-2 rounded-lg p-[3px] gap-[2px]">
            {STORE_KEYS.map((s) => {
              const active = s === store;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStore(s)}
                  className={[
                    "px-3 py-1 rounded-md text-[11px] font-medium uppercase tracking-wider transition-all",
                    active ? "bg-accent text-on-accent shadow-sm" : "text-text-dim hover:text-text",
                  ].join(" ")}
                >
                  {STORE_CONFIG[s].label.replace("Store ", "")}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-text-dim cursor-pointer select-none">
            <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} />
            include drafts
          </label>
          <label
            className="flex items-center gap-1.5 text-[11px] text-text-dim cursor-pointer select-none"
            title="Off by default — only untreated products are shown. Turn on to also see products already backfilled."
          >
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            show done
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product name…"
            className="flex-1 min-w-[180px] bg-bg-elev-2 border border-border rounded-md px-3 py-1.5 text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
          <Button
            variant={pasteOpen ? "primary" : "secondary"}
            size="sm"
            onClick={() => setPasteOpen((v) => !v)}
            disabled={loading}
          >
            📋 Paste list
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void runBulk("generate")} disabled={bulkBusy || loading}>
            ✨ Generate all ({counts.withKeywords})
          </Button>
          <Button variant="primary" size="sm" onClick={() => void runBulk("save")} disabled={bulkBusy || loading || counts.generated === 0}>
            ⬆ Save all ({counts.generated})
          </Button>
        </div>

        {/* Paste-list accelerator */}
        {pasteOpen && (
          <div className="px-6 py-3 border-b border-border bg-bg-elev-2">
            <p className="text-[12px] font-medium text-text mb-1">📋 Paste your keyword list</p>
            <p className="text-[11px] text-text-faint mb-2 leading-relaxed">
              One line per product. Paste straight from Google Sheets (column <strong>product name</strong> + column(s){" "}
              <strong>keywords</strong>), or use <code className="bg-bg-elev px-1 rounded">name | kw1, kw2</code> or{" "}
              <code className="bg-bg-elev px-1 rounded">name: kw1, kw2</code>. Matches on product name; a header row is skipped.
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              placeholder={"Liviah\tmekko, juhlamekko, pitkä mekko\nSolène\tbluse, pellavapaita, naisten paita"}
              className="w-full text-[12px] font-mono text-text bg-bg-elev border border-border rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent resize-y"
            />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Button variant="primary" size="sm" onClick={applyPaste} disabled={!pasteText.trim()}>
                ↓ Fill fields
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPasteText("");
                  setPasteResult(null);
                }}
              >
                Clear
              </Button>
              {pasteResult && (
                <span className="text-[11px] text-text-dim">
                  <span className="text-accent">✓ {pasteResult.matched + pasteResult.fuzzy} filled</span>
                  {pasteResult.fuzzy > 0 && <span className="text-text-faint"> ({pasteResult.fuzzy} approximate)</span>}
                  {pasteResult.ambiguous.length > 0 && (
                    <span className="text-warning"> · {pasteResult.ambiguous.length} ambiguous</span>
                  )}
                  {pasteResult.unmatched.length > 0 && (
                    <span className="text-danger"> · {pasteResult.unmatched.length} not found</span>
                  )}
                </span>
              )}
            </div>
            {pasteResult && (pasteResult.unmatched.length > 0 || pasteResult.ambiguous.length > 0) && (
              <div className="mt-2 text-[11px] leading-relaxed">
                {pasteResult.unmatched.length > 0 && (
                  <p className="text-text-faint">
                    <span className="text-danger font-medium">Not found</span> (type these manually or fix the name):{" "}
                    {pasteResult.unmatched.join(" · ")}
                  </p>
                )}
                {pasteResult.ambiguous.map((a) => (
                  <p key={a.name} className="text-text-faint">
                    <span className="text-warning font-medium">“{a.name}”</span> matches multiple: {a.candidates.join(", ")}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4 max-h-[68vh] overflow-y-auto">
          {/* How-it-works legend so each step is self-explanatory */}
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[11px] text-text-faint mb-3 pb-3 border-b border-border">
            <span className="font-medium text-text-dim">How it works:</span>
            <span><strong className="text-text-dim">1.</strong> Enter keywords</span>
            <span className="text-text-faint">→</span>
            <span><strong className="text-text-dim">2.</strong> Generate (writes new Finnish text)</span>
            <span className="text-text-faint">→</span>
            <span><strong className="text-text-dim">3.</strong> Check current vs new</span>
            <span className="text-text-faint">→</span>
            <span><strong className="text-text-dim">4.</strong> Save to Shopify</span>
          </div>
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12 text-text-faint">
              <Spinner size={32} />
              <p className="text-[13px]">Loading products from Shopify {store.toUpperCase()}…</p>
            </div>
          ) : error ? (
            <p className="text-[13px] text-danger text-center py-10">
              Could not load products: {error}
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-[13px] text-text-faint text-center py-10">
              {groups.length === 0
                ? `No ${includeDrafts ? "" : "active "}products found in ${store.toUpperCase()}.`
                : "No products match your search."}
            </p>
          ) : (
            <div className="space-y-3">
              {filtered.map((g) => (
                <DressCard
                  key={g.key}
                  group={g}
                  row={rows[g.key]}
                  onKeywords={(v) =>
                    patchRow(g.key, {
                      keywords: v,
                      // clear a stale "enter keywords" error as soon as they type
                      ...(rows[g.key]?.status === "error" ? { status: "todo" as RowStatus, err: undefined } : {}),
                    })
                  }
                  onGenField={(field, v) => patchRow(g.key, { gen: { ...rows[g.key].gen, [field]: v } })}
                  onGenerate={() => void generateRow(g)}
                  onSave={() => void saveRow(g)}
                  onRevert={() => void revertRow(g)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-bg-elev-2 rounded-b-2xl">
          <span className="text-[11px] text-text-faint">
            {includeDrafts ? "Active + draft" : "Active"} products only · nothing goes live until you click save.
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  const map: Record<RowStatus, { label: string; cls: string; hint: string }> = {
    todo:       { label: "To do",        cls: "bg-bg-elev text-text-faint",  hint: "Not started yet — enter keywords and click Generate." },
    generating: { label: "Generating…",  cls: "bg-accent/15 text-accent",    hint: "Claude is writing the new Finnish text…" },
    generated:  { label: "Generated",    cls: "bg-accent/15 text-accent",    hint: "New text is ready — check it, then click Save to Shopify." },
    saving:     { label: "Saving…",      cls: "bg-warning/15 text-warning",  hint: "Writing the text to Shopify…" },
    saved:      { label: "✓ Saved",      cls: "bg-accent/20 text-accent",    hint: "Saved to Shopify." },
    error:      { label: "Error",        cls: "bg-danger/15 text-danger",    hint: "Something went wrong — see the red message." },
  };
  const m = map[status];
  return <span title={m.hint} className={`text-[10px] font-semibold px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
}

function DressCard({
  group: g,
  row,
  onKeywords,
  onGenField,
  onGenerate,
  onSave,
  onRevert,
}: {
  group: BackfillGroup;
  row: RowState | undefined;
  onKeywords: (v: string) => void;
  onGenField: (field: "description" | "meta_description" | "m_title_specs", v: string) => void;
  onGenerate: () => void;
  onSave: () => void;
  onRevert: () => void;
}) {
  const status = row?.status ?? "todo";
  const showGen = status === "generated" || status === "saving" || status === "saved";
  const busy = status === "generating" || status === "saving";

  return (
    <div className="rounded-[12px] bg-bg-elev-2 border border-border p-4">
      <div className="flex items-start gap-3">
        {g.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.image} alt={g.product_name} className="w-12 h-16 object-cover rounded-md border border-border flex-shrink-0" />
        ) : (
          <div className="w-12 h-16 rounded-md bg-bg-elev border border-border flex items-center justify-center text-text-faint text-[18px] flex-shrink-0">🖼️</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-text">{g.product_name || "(unnamed)"}</span>
            <StatusBadge status={status} />
            {g.handled && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded bg-accent/10 text-accent"
                title={g.backfilled_at ? `Already backfilled (${g.backfilled_at})` : "Already backfilled"}
              >
                ✓ done
              </span>
            )}
            <span className="text-[10px] text-text-faint">
              {g.product_ids.length} colour{g.product_ids.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {g.colours.map((c, i) => (
              <span key={`${c.id}-${i}`} className="text-[10px] text-text-dim bg-bg-elev px-1.5 py-0.5 rounded">
                {c.color || "—"}
              </span>
            ))}
          </div>

          {/* keyword input */}
          <div className="mt-2.5">
            <label className="text-[11px] font-medium text-text-dim">Keywords</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={row?.keywords ?? ""}
                onChange={(e) => onKeywords(e.target.value)}
                placeholder="e.g. mekko, juhlamekko, pitkä mekko — comma-separated"
                className="flex-1 bg-bg-elev border border-border rounded-md px-3 py-1.5 text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
              />
              <Button variant="secondary" size="sm" onClick={onGenerate} disabled={busy || !(row?.keywords ?? "").trim()}>
                {status === "generating" ? "✨…" : "✨ Generate"}
              </Button>
            </div>
          </div>

          {row?.err && <p className="text-[11px] text-danger mt-1.5">⚠ {row.err}</p>}

          {/* generated review */}
          {showGen && row && (
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <ReviewField
                label="Description"
                current={g.current.description_text}
                value={row.gen.description}
                onChange={(v) => onGenField("description", v)}
                rows={6}
              />
              <ReviewField
                label="Meta description (SEO)"
                current={g.current.meta_description}
                value={row.gen.meta_description}
                onChange={(v) => onGenField("meta_description", v)}
                rows={2}
              />
              <ReviewField
                label="m_title_specs (Google Shopping)"
                current={g.current.m_title_specs}
                value={row.gen.m_title_specs}
                onChange={(v) => onGenField("m_title_specs", v)}
                rows={2}
              />
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={onSave} disabled={busy || !row.gen.description}>
                  {status === "saving" ? "⬆…" : "⬆ Save to Shopify"}
                </Button>
                {status === "saved" && (
                  <button type="button" onClick={onRevert} className="text-[11px] text-text-faint hover:text-warning underline">
                    ↶ Revert to original
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewField({
  label,
  current,
  value,
  onChange,
  rows,
}: {
  label: string;
  current: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium text-text-dim">{label}</label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
        <div>
          <div className="text-[10px] text-text-faint uppercase tracking-wider mb-0.5">Current</div>
          <div className="text-[11px] text-text-faint bg-bg-elev border border-border rounded-md px-2.5 py-1.5 whitespace-pre-wrap max-h-32 overflow-y-auto">
            {current || <span className="italic">— empty —</span>}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-accent uppercase tracking-wider mb-0.5">New</div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            className="w-full text-[12px] text-text bg-bg-elev border border-border rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent resize-y"
          />
        </div>
      </div>
    </div>
  );
}
