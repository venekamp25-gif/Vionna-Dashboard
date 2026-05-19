"use client";

import { CompetitorPreview } from "@/components/review/CompetitorPreview";
import { ProductInfoCard } from "@/components/review/ProductInfoCard";
import { GeneratedContentCard } from "@/components/review/GeneratedContentCard";
import { ColorVariantsCard } from "@/components/review/ColorVariantsCard";
import { ImagesCard } from "@/components/review/ImagesCard";
import { NanoBananaSteps } from "@/components/review/NanoBananaSteps";
import { PublishPoolCard } from "@/components/review/PublishPoolCard";
import { Button } from "@/components/ui/Button";
import { useStep } from "@/lib/step";

export function ReviewStep() {
  const { setStep } = useStep();

  return (
    <>
      <CompetitorPreview />

      {/* Two-column grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[400px_1fr] gap-6 items-start">
        {/* Left column */}
        <div className="flex flex-col gap-6 min-w-0">
          <ProductInfoCard />
          <GeneratedContentCard />
          <ColorVariantsCard />
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6 min-w-0">
          <ImagesCard />
          <NanoBananaSteps />
          <PublishPoolCard />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 mt-8 -mx-8 px-8 py-4 bg-bg-elev border-t border-border backdrop-blur flex items-center justify-between gap-4">
        <span className="text-[13px] text-text-dim">
          Review the details, then publish when ready.
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(1)}>
            ← New product
          </Button>
          <Button variant="publish" onClick={() => setStep(4)}>
            Publish to Shopify →
          </Button>
        </div>
      </div>
    </>
  );
}
