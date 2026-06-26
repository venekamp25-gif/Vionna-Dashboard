"use client";

import { useEffect, useState } from "react";
import { api, BackendStatus } from "@/lib/api";
import { HealthCheckModal } from "./HealthCheckModal";

type ConnState = "checking" | "ok" | "fail";

export function BackendStatusBadge() {
  const [state, setState] = useState<ConnState>("checking");
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [err, setErr] = useState<string>("");
  const [healthOpen, setHealthOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .status()
        .then((s) => { if (!cancelled) { setStatus(s); setState("ok"); setErr(""); } })
        .catch((e) => { if (!cancelled) { setErr(String(e.message ?? e)); setState("fail"); } });
    void check();
    // Re-check periodically so a transient blip (e.g. a backend deploy/restart) auto-recovers
    // instead of sticking on "offline" until the user manually refreshes.
    const id = setInterval(() => void check(), 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Shared wrapper button — clicking the badge opens the full health-check
  // modal so the user can see WHY a subsystem is degraded without diving
  // into DevTools.
  const wrap = (content: React.ReactNode, tooltip: string) => (
    <>
      <button
        type="button"
        onClick={() => setHealthOpen(true)}
        className="text-[11px] flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
        title={`${tooltip}\n(click for full diagnostic)`}
      >
        {content}
      </button>
      <HealthCheckModal open={healthOpen} onClose={() => setHealthOpen(false)} />
    </>
  );

  if (state === "checking") {
    return wrap(
      <span className="text-text-faint flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-text-faint animate-pulse" />
        Connecting…
      </span>,
      "Checking backend connection"
    );
  }

  if (state === "fail") {
    return wrap(
      <span className="text-danger flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-danger" />
        Backend offline
      </span>,
      err || "Backend not reachable"
    );
  }

  // OK
  const parts: string[] = [];
  if (status?.dk) parts.push("DK ✓"); else parts.push("DK ⚠");
  if (status?.fr) parts.push("FR ✓"); else parts.push("FR ⚠");
  if (status?.fi) parts.push("FI ✓"); else parts.push("FI ⚠");
  if (status?.anthropic) parts.push("Claude ✓"); else parts.push("Claude ⚠");
  const anyDegraded = !status?.dk || !status?.fr || !status?.fi || !status?.anthropic;

  return wrap(
    <span className={`flex items-center gap-1.5 ${anyDegraded ? "text-warning" : "text-accent"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${anyDegraded ? "bg-warning" : "bg-accent"}`} />
      {parts.join(" · ")}
    </span>,
    anyDegraded ? "Some subsystems are degraded — click for details" : "Backend connection OK"
  );
}
