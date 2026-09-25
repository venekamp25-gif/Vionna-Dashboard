"use client";

import { useEffect, useState } from "react";
import { BUILD_SHA, fetchLiveBuild, isStaleBuild } from "@/lib/buildInfo";

/** How often a visible tab asks whether a newer build is live. */
const CHECK_EVERY_MS = 3 * 60 * 1000;

/**
 * "A newer version of the dashboard is live — reload." A long-open tab keeps
 * the bundle it loaded, so a fix that is live on Netlify is not in front of
 * the operator until they reload. The check runs on mount, whenever the tab
 * comes back into view, and every few minutes; "Later" silences it for this
 * live build only (the next deploy asks again).
 */
export function UpdateBanner() {
  const [liveSha, setLiveSha] = useState<string | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const live = await fetchLiveBuild();
      if (!cancelled && live) setLiveSha(live.sha);
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, CHECK_EVERY_MS);
    try {
      setDismissedFor(sessionStorage.getItem("update_banner_dismissed"));
    } catch {
      /* private mode — never dismissed, fine */
    }
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!isStaleBuild(BUILD_SHA, liveSha) || dismissedFor === liveSha) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] max-w-[92vw] flex items-center gap-3 px-4 py-3 rounded-2xl border border-accent/40 bg-bg-elev shadow-2xl text-[12.5px] text-text"
    >
      <span>
        A newer version of the dashboard is live. Reload to get it — this tab still runs build{" "}
        <code className="text-[11px] text-text-dim">{BUILD_SHA.slice(0, 7)}</code>, live is{" "}
        <code className="text-[11px] text-text-dim">{(liveSha ?? "").slice(0, 7)}</code>.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="px-3 h-8 rounded-[10px] bg-accent text-on-accent text-[12px] font-medium hover:opacity-90 transition whitespace-nowrap"
      >
        Reload now
      </button>
      <button
        type="button"
        onClick={() => {
          setDismissedFor(liveSha);
          try {
            sessionStorage.setItem("update_banner_dismissed", liveSha ?? "");
          } catch {
            /* no-op */
          }
        }}
        className="text-[12px] text-text-dim hover:text-text whitespace-nowrap"
      >
        Later
      </button>
    </div>
  );
}
