"use client";

import { useProduct } from "@/lib/product";

export function CompetitorPreview() {
  const { data } = useProduct();
  if (!data.competitor) return null;

  return (
    <div className="flex items-center gap-3 bg-bg-elev border border-border rounded-2xl px-5 py-4 mb-6">
      <div
        className="w-12 h-15 rounded-md shrink-0"
        style={{ background: "linear-gradient(135deg, var(--bg-elev-2), var(--bg-elev-3))" }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-text truncate">
          {data.competitor.title} — <span className="text-text-dim">{data.competitor.hostname}</span>
        </div>
        <div className="text-[11px] text-text-faint mt-0.5">
          {data.competitor.hostname} · {data.competitor.variants} variants · {data.competitor.price}
        </div>
      </div>
      <span className="px-2.5 py-1 rounded-full bg-bg-elev-2 text-text-dim text-[10px] font-semibold tracking-wider uppercase">
        Imported
      </span>
    </div>
  );
}
