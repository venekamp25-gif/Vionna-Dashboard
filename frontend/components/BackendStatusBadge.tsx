"use client";

import { useEffect, useState } from "react";
import { api, BackendStatus } from "@/lib/api";

type ConnState = "checking" | "ok" | "fail";

export function BackendStatusBadge() {
  const [state, setState] = useState<ConnState>("checking");
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    api
      .status()
      .then((s) => { setStatus(s); setState("ok"); })
      .catch((e) => { setErr(String(e.message ?? e)); setState("fail"); });
  }, []);

  if (state === "checking") {
    return (
      <span className="text-[11px] text-text-faint flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-text-faint animate-pulse" />
        Connecting…
      </span>
    );
  }

  if (state === "fail") {
    return (
      <span
        className="text-[11px] text-danger flex items-center gap-1.5"
        title={err || "Backend not reachable. Is start.bat running?"}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-danger" />
        Backend offline
      </span>
    );
  }

  // OK
  const parts: string[] = [];
  if (status?.dk) parts.push("DK ✓"); else parts.push("DK ⚠");
  if (status?.fr) parts.push("FR ✓"); else parts.push("FR ⚠");
  if (status?.anthropic) parts.push("Claude ✓"); else parts.push("Claude ⚠");

  return (
    <span
      className="text-[11px] text-accent flex items-center gap-1.5"
      title="Backend connection OK"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
      {parts.join(" · ")}
    </span>
  );
}
