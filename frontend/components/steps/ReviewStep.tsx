"use client";

import { CompetitorPreview } from "@/components/review/CompetitorPreview";
import { ProductInfoCard } from "@/components/review/ProductInfoCard";
import { GeneratedContentCard } from "@/components/review/GeneratedContentCard";

export function ReviewStep() {
  return (
    <>
      <CompetitorPreview />

      {/* Two-column grid: left (sidebar) ~400px, right (main) flexible */}
      <div className="grid grid-cols-1 xl:grid-cols-[400px_1fr] gap-6 items-start">
        {/* Left column */}
        <div className="flex flex-col gap-6 min-w-0">
          <ProductInfoCard />
          <GeneratedContentCard />
        </div>

        {/* Right column placeholder (Images + NB workflow comes in 3e) */}
        <div className="bg-bg-elev border border-border rounded-2xl p-8 min-w-0">
          <h2 className="text-[15px] font-semibold mb-2 text-text">Right column — coming in 3e</h2>
          <p className="text-text-dim text-sm">
            Images section + Nano Banana workflow + publish pool will be built in the next substep.
          </p>
        </div>
      </div>
    </>
  );
}
