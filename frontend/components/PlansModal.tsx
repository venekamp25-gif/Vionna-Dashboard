"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { plansApi, PlanEntry } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onPendingCount?: (n: number) => void;
}

/**
 * Approval inbox for the hands-off fix pipeline. When a reported "bug" is
 * really a feature request (or otherwise needs a human call), the fix routine
 * posts a PLAN to the droplet instead of auto-merging code. This modal lists
 * pending plans; Akkoord fires the routine to build exactly that plan
 * (PR → CI → auto-merge), Afwijzen closes it without building.
 */
export function PlansModal({ open, onClose, onPendingCount }: Props) {
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await plansApi.list();
      setPlans(r.entries);
      onPendingCount?.(r.pending_count);
    } catch {
      setError("Kon plannen niet laden — is de backend bereikbaar?");
    } finally {
      setLoading(false);
    }
  }, [onPendingCount]);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setExpanded(null);
    void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const decide = async (id: number, action: "approve" | "reject") => {
    setBusy(id);
    setError(null);
    try {
      const r = await (action === "approve" ? plansApi.approve(id) : plansApi.reject(id));
      if (r.error) {
        setError(r.error);
      } else {
        setNotice(
          action === "approve"
            ? `Plan #${id} goedgekeurd — de bouw is gestart. Je krijgt een melding als de PR klaarstaat (auto-merge bij groen CI).`
            : `Plan #${id} afgewezen.`
        );
        await refresh();
      }
    } catch {
      setError("Actie mislukt — probeer het opnieuw.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-16 px-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-bg-elev border border-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <div>
            <h2 className="text-[15px] font-semibold text-text">📋 Plans — wacht op akkoord</h2>
            <p className="text-[12px] text-text-faint mt-0.5 leading-relaxed">
              Feature requests uit de bug-melder. Akkoord = automatisch bouwen, PR en live bij groen CI.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-faint hover:text-text text-[18px] leading-none px-1"
            aria-label="Sluiten"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {notice && (
            <div className="text-[12px] rounded-md border border-accent/40 bg-[var(--accent-soft)] text-text px-3 py-2">
              {notice}
            </div>
          )}
          {error && (
            <div className="text-[12px] rounded-md border border-red-500/40 bg-red-500/10 text-red-400 px-3 py-2">
              {error}
            </div>
          )}
          {loading && <p className="text-[12px] text-text-faint">Laden…</p>}
          {!loading && plans.length === 0 && (
            <p className="text-[12px] text-text-faint py-6 text-center">
              Geen plannen die op akkoord wachten. 🎉
            </p>
          )}
          {plans.map((p) => (
            <div key={p.id} className="border border-border rounded-lg px-4 py-3 bg-bg-elev-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-text">
                    #{p.id} — {p.title}
                    {p.bug_id != null && (
                      <span className="text-text-faint font-normal"> (bug #{p.bug_id})</span>
                    )}
                  </p>
                  {p.summary && (
                    <p className="text-[12px] text-text-dim mt-1 leading-relaxed">{p.summary}</p>
                  )}
                  {p.plan && (
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                      className="text-[11px] text-accent hover:underline mt-1.5"
                    >
                      {expanded === p.id ? "▲ Verberg volledig plan" : "▼ Bekijk volledig plan"}
                    </button>
                  )}
                  {expanded === p.id && (
                    <pre className="text-[11px] text-text-dim whitespace-pre-wrap mt-2 border-t border-border pt-2 max-h-56 overflow-y-auto">
                      {p.plan}
                    </pre>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => void decide(p.id, "approve")}
                    disabled={busy !== null}
                  >
                    {busy === p.id ? "Bezig…" : "✓ Akkoord"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void decide(p.id, "reject")}
                    disabled={busy !== null}
                  >
                    ✕ Afwijzen
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
