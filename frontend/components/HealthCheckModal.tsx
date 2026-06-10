"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";

interface Check {
  name: string;
  description: string;
  status: "checking" | "ok" | "warn" | "fail";
  detail?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * One-page diagnostic of every dependency the dashboard relies on.
 * Click the status badge in the header to open this. Helps figure out
 * whether a broken feature is a backend issue, an auth issue, or an
 * upstream Shopify/Higgsfield/Anthropic issue — without having to dig
 * through DevTools.
 */
export function HealthCheckModal({ open, onClose }: Props) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);

  const runAll = async () => {
    setRunning(true);
    const initial: Check[] = [
      { name: "Backend", description: "Python Flask API reachable", status: "checking" },
      { name: "Logged in", description: "Next.js session valid", status: "checking" },
      { name: "Store DK", description: "Shopify token + scopes", status: "checking" },
      { name: "Store FR", description: "Shopify token + scopes", status: "checking" },
      { name: "Store FI", description: "Shopify token + scopes", status: "checking" },
      { name: "Claude (Anthropic)", description: "Content generation API key", status: "checking" },
    ];
    setChecks(initial);

    // 1. Backend reachability + Shopify + Claude checks all come from /api/status
    let backendOk = false;
    try {
      const s = await api.status();
      backendOk = true;
      setChecks((cur) => updateCheck(cur, "Backend", "ok", "Reachable + responding"));
      setChecks((cur) => updateCheck(cur, "Store DK", s.dk ? "ok" : "fail", s.dk ? "Token loaded" : "No token — re-auth needed"));
      setChecks((cur) => updateCheck(cur, "Store FR", s.fr ? "ok" : "fail", s.fr ? "Token loaded" : "No token — re-auth needed"));
      setChecks((cur) => updateCheck(cur, "Store FI", s.fi ? "ok" : "fail", s.fi ? "Token loaded" : "No token — re-auth needed"));
      setChecks((cur) => updateCheck(cur, "Claude (Anthropic)", s.anthropic ? "ok" : "fail", s.anthropic ? "API key configured" : "ANTHROPIC_API_KEY missing"));
    } catch (e) {
      setChecks((cur) => updateCheck(cur, "Backend", "fail", e instanceof Error ? e.message : String(e)));
      // If backend is down everything else is unknown
      setChecks((cur) => updateCheck(cur, "Store DK", "warn", "Skipped — backend unreachable"));
      setChecks((cur) => updateCheck(cur, "Store FR", "warn", "Skipped — backend unreachable"));
      setChecks((cur) => updateCheck(cur, "Store FI", "warn", "Skipped — backend unreachable"));
      setChecks((cur) => updateCheck(cur, "Claude (Anthropic)", "warn", "Skipped — backend unreachable"));
    }

    // 2. Auth check — separate /api/me on Next.js
    try {
      const res = await fetch("/api/me", { credentials: "include", cache: "no-store" });
      if (res.status === 401) {
        setChecks((cur) => updateCheck(cur, "Logged in", "fail", "Session expired — log in again"));
      } else if (res.ok) {
        const j = (await res.json()) as { email: string | null };
        setChecks((cur) => updateCheck(cur, "Logged in", j.email ? "ok" : "fail", j.email ?? "No email returned"));
      } else {
        setChecks((cur) => updateCheck(cur, "Logged in", "warn", `Unexpected ${res.status}`));
      }
    } catch (e) {
      setChecks((cur) => updateCheck(cur, "Logged in", "warn", e instanceof Error ? e.message : String(e)));
    }
    void backendOk;

    setRunning(false);
  };

  // Auto-run when opened
  useEffect(() => {
    if (open) {
      void runAll();
    } else {
      setChecks([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-16 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-bg-elev border border-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-[16px] font-semibold text-text">System health</h2>
            <p className="text-[11px] text-text-faint mt-0.5">
              {failCount > 0
                ? `${failCount} subsystem${failCount === 1 ? "" : "s"} failing${warnCount > 0 ? `, ${warnCount} degraded` : ""}`
                : warnCount > 0
                ? `${warnCount} subsystem${warnCount === 1 ? "" : "s"} degraded`
                : "All subsystems operational"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-faint hover:text-text text-xl px-2"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-4 space-y-2">
          {checks.map((c) => (
            <CheckRow key={c.name} check={c} />
          ))}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-elev-2 rounded-b-2xl">
          <span className="text-[11px] text-text-faint">
            Click ↻ to re-test all subsystems.
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={runAll} disabled={running}>
              {running ? "⟳ Re-checking…" : "↻ Re-run checks"}
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: Check }) {
  const colour =
    check.status === "ok"
      ? "text-accent"
      : check.status === "warn"
      ? "text-warning"
      : check.status === "fail"
      ? "text-danger"
      : "text-text-faint";
  const icon =
    check.status === "checking" ? "⟳" :
    check.status === "ok"       ? "✓" :
    check.status === "warn"     ? "⚠" :
    "✕";
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-[10px] bg-bg-elev-2 border border-border">
      <span className={`text-lg leading-none ${colour} ${check.status === "checking" ? "animate-spin inline-block" : ""}`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text">{check.name}</div>
        <div className="text-[11px] text-text-faint">{check.description}</div>
        {check.detail && (
          <div className={`text-[11px] mt-0.5 ${colour}`}>{check.detail}</div>
        )}
      </div>
    </div>
  );
}

function updateCheck(
  cur: Check[],
  name: string,
  status: Check["status"],
  detail?: string
): Check[] {
  return cur.map((c) => (c.name === name ? { ...c, status, detail } : c));
}
