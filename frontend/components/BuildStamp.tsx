"use client";

import { useEffect, useState } from "react";
import { BUILD_SHA, fetchLiveBuild } from "@/lib/buildInfo";

/**
 * "build a1b2c3d": which build this tab runs, so a screenshot says which
 * version produced it. The baked sha when there is one; on Netlify nothing
 * gets baked ("dev"), so the tab shows the build it first saw from /api/build.
 */
export function BuildStamp({ className = "" }: { className?: string }) {
  const [sha, setSha] = useState<string>(BUILD_SHA);

  useEffect(() => {
    if (BUILD_SHA !== "dev") return;
    let cancelled = false;
    void fetchLiveBuild().then((live) => {
      if (!cancelled && live?.sha && live.sha !== "dev") setSha(live.sha);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (sha === "dev") return null;
  return (
    <span className={`text-[10.5px] text-text-faint font-mono ${className}`} title="Which build of the dashboard this tab runs">
      build {sha.slice(0, 7)}
    </span>
  );
}
