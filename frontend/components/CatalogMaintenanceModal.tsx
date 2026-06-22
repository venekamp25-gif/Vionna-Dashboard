"use client";

import { useState } from "react";
import { CatalogJob, CatalogJobType } from "@/lib/api";
import { StoreKey, STORE_CONFIG, STORE_KEYS, useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { startCatalogJob, waitForJob, useCatalogJobs } from "@/lib/catalogJobs";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface JobDef {
  type: CatalogJobType;
  title: string;
  desc: string;
  cta: string;
  danger?: boolean;
  confirm?: (store: string) => string;
  excludeFromRunAll?: boolean;
}

const JOB_DEFS: JobDef[] = [
  {
    type: "bold_cleanup",
    title: "Fix ** in descriptions",
    desc: "Convert literal **bold** left in existing product descriptions to real bold. Formatting only — the wording doesn't change.",
    cta: "Run cleanup",
  },
  {
    type: "channels",
    title: "Publish to all sales channels",
    desc: "(Re)publish every product to the store's Online Store, Facebook/Meta, Google and Pinterest channels. Idempotent — already-published products are just re-confirmed.",
    cta: "Backfill channels",
  },
  {
    type: "cutline",
    title: "Fix missing colour swatches",
    desc: "Set the colour swatch (theme.cutline) from the product handle on products that are missing one.",
    cta: "Fix cutlines",
  },
  {
    type: "dedup",
    title: "Draft true duplicates",
    desc: "Set verified duplicates to draft — only when another product has the SAME title AND the SAME featured image (now also matching a re-uploaded photo with a different extension/hash). Handle collisions with a different image are left untouched. Reversible (re-activate in Shopify).",
    cta: "Draft duplicates",
    danger: true,
    confirm: (s) => `This sets verified duplicate products to DRAFT on Store ${s}.\nThey stay fully recoverable in Shopify (just re-activate).\n\nContinue?`,
  },
  {
    type: "relink",
    title: "Relink colour variants",
    desc: "Re-link colour variants of the same product (the numbered -1/-10 handles) so the colour swatches show together again. Conservative: only touches sets that clearly belong together (one title, no conflicting links); mixed sets are left alone.",
    cta: "Relink siblings",
  },
  {
    type: "fix_titles_scan",
    title: "Check sibling collection names",
    desc: "Read-only scan: lists every sibling collection whose name isn't '<Product> Siblings' (e.g. 'angela collection') and what it would become. Changes nothing — safe to run anytime.",
    cta: "Scan names",
    excludeFromRunAll: true,
  },
  {
    type: "fix_titles_apply",
    title: "Fix sibling collection names",
    desc: "Renames mis-named sibling collections to '<Product> Siblings' and re-links their colour variants so the swatches show. The handle/URL is left untouched, so storefront links stay intact. Reversible. Run the scan first.",
    cta: "Fix names",
    danger: true,
    excludeFromRunAll: true,
    confirm: (s) =>
      `Rename mis-titled sibling collections on Store ${s} to '<Product> Siblings' and re-link their colour variants?\n\n` +
      `Handles/URLs are NOT changed, so storefront links stay intact, and it's reversible.\n` +
      `Run the Scan first if you haven't. Continue?`,
  },
];

export function CatalogMaintenanceModal({ open, onClose }: Props) {
  const { store: globalStore } = useStore();
  const [store, setStore] = useState<StoreKey>(globalStore);
  const [runningAll, setRunningAll] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Shared store — keeps polling and remembers progress even while this modal is
  // closed, and re-discovers running jobs after a page reload.
  const allJobs = useCatalogJobs();

  const jobsByType: Record<string, CatalogJob | null> = {};
  for (const def of JOB_DEFS) {
    // list is newest-first → the first match is the latest job of that type
    jobsByType[def.type] = allJobs.find((j) => j.store === store && j.type === def.type) ?? null;
  }
  const anyRunning = runningAll || allJobs.some((j) => j.store === store && j.status === "running");

  // Start one job and resolve only when it finishes. Used for a single "Run"
  // click and chained by "Run all for this store".
  const runJobToCompletion = async (def: JobDef, skipConfirm = false): Promise<void> => {
    if (def.confirm && !skipConfirm && !window.confirm(def.confirm(store.toUpperCase()))) return;
    setStartError(null);
    try {
      const r = await startCatalogJob(store, def.type);
      if (r.error || !r.job_id) throw new Error(r.error || "Could not start job");
      await waitForJob(r.job_id);
    } catch (e) {
      setStartError(`${def.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Run every non-excluded job sequentially for the selected store (one confirm up
  // front). The name-fixing jobs are excluded — those stay deliberate scan-first actions.
  const runAll = async () => {
    const runAllDefs = JOB_DEFS.filter((d) => !d.excludeFromRunAll);
    if (
      !window.confirm(
        `Run all ${runAllDefs.length} maintenance jobs on Store ${store.toUpperCase()}, one after another?\n\n` +
          `This includes drafting verified duplicates (reversible in Shopify). It can take a while on a large store.`
      )
    )
      return;
    setRunningAll(true);
    for (const def of runAllDefs) {
      await runJobToCompletion(def, true);
    }
    setRunningAll(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-16 px-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-bg-elev border border-border rounded-2xl shadow-2xl mb-16"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-[16px] font-semibold text-text">🧹 Catalogue maintenance</h2>
            <p className="text-[11px] text-text-faint mt-0.5">
              Bulk fixes across a whole store. Each runs in the background — safe to close this and come back.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-text-faint hover:text-text text-xl px-2">
            ✕
          </button>
        </div>

        {/* Store selector + run-all */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-text-dim">Store:</span>
          <div className="inline-flex bg-bg-elev-2 rounded-lg p-[3px] gap-[2px]">
            {STORE_KEYS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStore(s)}
                className={[
                  "px-3 py-1 rounded-md text-[11px] font-medium uppercase tracking-wider transition-all",
                  s === store ? "bg-accent text-on-accent shadow-sm" : "text-text-dim hover:text-text",
                ].join(" ")}
              >
                {STORE_CONFIG[s].label.replace("Store ", "")}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <Button variant="primary" size="sm" onClick={() => void runAll()} disabled={anyRunning}>
              {runningAll ? "⟳ Running all…" : "▶ Run all for this store"}
            </Button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          {startError && <p className="text-[11px] text-danger -mb-1">⚠ {startError}</p>}
          {anyRunning && (
            <p className="text-[11px] text-text-faint -mb-1">
              A job is running for this store — progress keeps updating even if you close this window.
            </p>
          )}
          {JOB_DEFS.map((def) => (
            <JobCard
              key={def.type}
              def={def}
              job={jobsByType[def.type]}
              anyRunning={anyRunning}
              onRun={() => void runJobToCompletion(def)}
            />
          ))}
        </div>

        <div className="px-6 py-3 border-t border-border bg-bg-elev-2 rounded-b-2xl flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function JobCard({
  def,
  job,
  anyRunning,
  onRun,
}: {
  def: JobDef;
  job: CatalogJob | null;
  anyRunning: boolean;
  onRun: () => void;
}) {
  const running = job?.status === "running";
  const pct = job && job.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : null;

  return (
    <div className="rounded-[12px] bg-bg-elev-2 border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text">{def.title}</div>
          <p className="text-[11px] text-text-faint mt-0.5 leading-relaxed">{def.desc}</p>
        </div>
        <Button
          variant={def.danger ? "secondary" : "primary"}
          size="sm"
          onClick={onRun}
          disabled={running || anyRunning}
        >
          {running ? "⟳ Running…" : def.cta}
        </Button>
      </div>

      {job && (
        <div className="mt-3 border-t border-border pt-2.5">
          {pct !== null && (
            <div className="h-1 rounded-full bg-bg-elev overflow-hidden mb-1.5">
              <div className="h-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <StatusDot status={job.status} />
            <span className="text-text-dim">
              {job.processed}
              {job.total != null ? ` / ${job.total}` : ""} scanned
            </span>
            <span className="text-accent">· {job.changed} changed</span>
            {job.skipped > 0 && <span className="text-text-faint">· {job.skipped} skipped</span>}
            {job.errors.length > 0 && <span className="text-danger">· {job.errors.length} errors</span>}
          </div>
          {job.summary && <p className="text-[11px] text-text-dim mt-1">{job.summary}</p>}
          {job.errors.length > 0 && (
            <details className="mt-1">
              <summary className="text-[11px] text-danger cursor-pointer">Show errors</summary>
              <div className="text-[10px] text-text-faint mt-1 space-y-0.5 max-h-28 overflow-y-auto">
                {job.errors.slice(0, 25).map((e, i) => (
                  <div key={i}>• {e}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: CatalogJob["status"] }) {
  const map = {
    running: { cls: "text-accent", label: "Running" },
    done: { cls: "text-accent", label: "Done" },
    error: { cls: "text-danger", label: "Error" },
  } as const;
  const m = map[status];
  return (
    <span className={`font-semibold ${m.cls}`}>
      {status === "running" ? "⟳" : status === "done" ? "✓" : "✕"} {m.label}
    </span>
  );
}
