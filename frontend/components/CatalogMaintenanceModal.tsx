"use client";

import { useEffect, useRef, useState } from "react";
import { api, CatalogJob, CatalogJobType } from "@/lib/api";
import { StoreKey, STORE_CONFIG, STORE_KEYS, useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";

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
    desc: "Set verified duplicates to draft — only when another product has the SAME title AND the SAME featured image. Handle collisions with a different image are left untouched. Reversible (re-activate in Shopify).",
    cta: "Draft duplicates",
    danger: true,
    confirm: (s) => `This sets verified duplicate products to DRAFT on Store ${s}.\nThey stay fully recoverable in Shopify (just re-activate).\n\nContinue?`,
  },
];

export function CatalogMaintenanceModal({ open, onClose }: Props) {
  const { store: globalStore } = useStore();
  const [store, setStore] = useState<StoreKey>(globalStore);
  const [jobs, setJobs] = useState<Record<string, CatalogJob | null>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clearTimers = () => {
    Object.values(timers.current).forEach((t) => clearTimeout(t));
    timers.current = {};
  };

  // Stop polling + reset the display when the modal closes or the store changes.
  useEffect(() => {
    if (!open) {
      clearTimers();
      setJobs({});
    }
    return () => clearTimers();
  }, [open]);

  useEffect(() => {
    clearTimers();
    setJobs({});
  }, [store]);

  const pollJob = (type: CatalogJobType, id: string) => {
    const tick = async () => {
      try {
        const s = await api.catalogJobStatus(id);
        setJobs((j) => ({ ...j, [type]: s }));
        if (s.status === "running") timers.current[type] = setTimeout(tick, 2000);
      } catch {
        timers.current[type] = setTimeout(tick, 3000); // transient — keep polling
      }
    };
    void tick();
  };

  const runJob = async (def: JobDef) => {
    if (def.confirm && !window.confirm(def.confirm(store.toUpperCase()))) return;
    // optimistic "running" placeholder
    setJobs((j) => ({
      ...j,
      [def.type]: {
        id: "", type: def.type, store, status: "running", total: null,
        processed: 0, changed: 0, skipped: 0, errors: [], summary: "",
        started_at: "", finished_at: null,
      },
    }));
    try {
      const r = await api.catalogJobStart(store, def.type);
      if (r.error || !r.job_id) throw new Error(r.error || "Could not start job");
      pollJob(def.type, r.job_id);
    } catch (e) {
      setJobs((j) => ({
        ...j,
        [def.type]: {
          id: "", type: def.type, store, status: "error", total: null,
          processed: 0, changed: 0, skipped: 0, errors: [String(e instanceof Error ? e.message : e)],
          summary: "Could not start", started_at: "", finished_at: null,
        },
      }));
    }
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

        {/* Store selector */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-3">
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
        </div>

        <div className="px-6 py-4 space-y-3">
          {JOB_DEFS.map((def) => (
            <JobCard key={def.type} def={def} job={jobs[def.type] ?? null} onRun={() => void runJob(def)} />
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

function JobCard({ def, job, onRun }: { def: JobDef; job: CatalogJob | null; onRun: () => void }) {
  const running = job?.status === "running";
  const pct = job && job.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : null;

  return (
    <div className="rounded-[12px] bg-bg-elev-2 border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text">{def.title}</div>
          <p className="text-[11px] text-text-faint mt-0.5 leading-relaxed">{def.desc}</p>
        </div>
        <Button variant={def.danger ? "secondary" : "primary"} size="sm" onClick={onRun} disabled={running}>
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
