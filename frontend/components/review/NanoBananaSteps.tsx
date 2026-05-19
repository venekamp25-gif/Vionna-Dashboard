"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ImageTile } from "@/components/ui/ImageTile";
import { Lightbox } from "@/components/ui/Lightbox";
import { useProduct, NbResult, PoolPhoto } from "@/lib/product";

const STEPS = [
  { n: 1, title: "First model shot",      desc: "Product on model with reference background (4 variants)" },
  { n: 2, title: "Detailed model shot",   desc: "Full face + product details visible" },
  { n: 3, title: "Back view",             desc: "Same model, same background, back view" },
  { n: 4, title: "Close-up material",     desc: "Texture and detail shot of the material" },
];

// Mock images per step (placeholders)
const MOCK_RESULTS = (step: number) =>
  Array.from({ length: 4 }, (_, i) => ({
    url: `https://placehold.co/600x800/${["10b981","059669","16a34a","15803d"][i]}/0b0f14?text=NB+Step+${step}+%E2%80%A2+${i + 1}&font=raleway`,
    selected: false,
  }));

export function NanoBananaSteps() {
  const { data, patch } = useProduct();
  const [generatingStep, setGeneratingStep] = useState<number | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  const runStep = (stepNum: number) => {
    setGeneratingStep(stepNum);
    // Demo mode: simulate 2s generation
    setTimeout(() => {
      const results = MOCK_RESULTS(stepNum);
      patch({
        nbResults: { ...data.nbResults, [stepNum]: results },
      });
      setGeneratingStep(null);
    }, 2000);
  };

  const toggleSelect = (stepNum: number, idx: number) => {
    const current = data.nbResults[stepNum] ?? [];
    const tile = current[idx];
    if (!tile) return;
    const willSelect = !tile.selected;

    // Max 2 selected per step — deselect oldest if needed
    let updated = current.map((r, i) => (i === idx ? { ...r, selected: willSelect } : r));
    if (willSelect) {
      const selectedCount = updated.filter((r) => r.selected).length;
      if (selectedCount > 2) {
        // unselect the earliest selected (not this one)
        const earliest = updated.findIndex((r, i) => r.selected && i !== idx);
        if (earliest >= 0) updated = updated.map((r, i) => (i === earliest ? { ...r, selected: false } : r));
      }
    }

    // Update publish pool
    const labelFor = (i: number) => `NB Step ${stepNum}.${i + 1}`;
    let pool = data.publishPool.filter((p) => !p.label.startsWith(`NB Step ${stepNum}.`));
    updated.forEach((r, i) => {
      if (r.selected) pool.push({ url: r.url, label: labelFor(i), color: "shared", selected: true });
    });

    patch({
      nbResults: { ...data.nbResults, [stepNum]: updated },
      publishPool: pool,
    });
  };

  return (
    <div className="space-y-4 mt-2">
      {STEPS.map(({ n, title, desc }) => {
        const results = data.nbResults[n] ?? [];
        const isGenerating = generatingStep === n;
        const done = results.length > 0;

        return (
          <div
            key={n}
            className="bg-bg-elev-2 border border-border rounded-[14px] p-4 transition-colors hover:border-border-hover"
          >
            <div className="flex items-center gap-3 mb-3">
              <span
                className={[
                  "px-2 py-1 rounded text-[11px] font-bold tracking-wide uppercase",
                  done ? "bg-accent text-on-accent" : "bg-bg-elev text-text-dim",
                ].join(" ")}
              >
                Step {n}
              </span>
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-text">{title}</div>
                <div className="text-[11px] text-text-faint">{desc}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => runStep(n)}
                disabled={isGenerating}
              >
                {isGenerating ? "⟳ Generating…" : done ? "✦ Regenerate (4)" : "✦ Generate 4 variants"}
              </Button>
            </div>

            {(isGenerating || done) && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {isGenerating
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="aspect-[3/4] rounded-[10px] bg-gradient-to-br from-bg-elev to-bg-elev-3 animate-pulse flex items-center justify-center"
                      >
                        <span className="text-[11px] text-text-faint">Variant {i + 1}</span>
                      </div>
                    ))
                  : results.map((r, i) => (
                      <ImageTile
                        key={i}
                        url={r.url}
                        label={`Variant ${i + 1}`}
                        selected={r.selected}
                        onToggle={() => toggleSelect(n, i)}
                        onZoom={() => setZoomUrl(r.url)}
                        onRegenerate={() => runStep(n)}
                      />
                    ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Step 5: Color variants — shown but disabled until step 1-4 has selections */}
      <Step5ColorVariants />

      <Lightbox url={zoomUrl} onClose={() => setZoomUrl(null)} />
      <p className="text-[11px] text-text-faint text-center pt-2">
        Demo mode — real Higgsfield generation hooks up in Phase 4.
      </p>
    </div>
  );
}

function Step5ColorVariants() {
  const { data } = useProduct();
  const otherColors = data.colors.slice(1); // primary color is original, others are step 5 targets
  const hasModelImage = Object.values(data.nbResults).some((arr) => arr.some((r) => r.selected));

  return (
    <div className="bg-bg-elev-2 border border-border rounded-[14px] p-4 opacity-90">
      <div className="flex items-center gap-3 mb-3">
        <span className="px-2 py-1 rounded text-[11px] font-bold tracking-wide uppercase bg-bg-elev text-text-dim">
          Step 5
        </span>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-text">Color variants</div>
          <div className="text-[11px] text-text-faint">Per color: same model + background, different color</div>
        </div>
      </div>
      {!hasModelImage ? (
        <div className="px-4 py-3 rounded-md bg-bg-elev text-[12px] text-text-faint text-center">
          Select an image in steps 1–4 first to generate color variants.
        </div>
      ) : otherColors.length === 0 ? (
        <div className="px-4 py-3 rounded-md bg-bg-elev text-[12px] text-text-faint text-center">
          No additional colors to generate (only the primary color is in your list).
        </div>
      ) : (
        <div className="space-y-3">
          {otherColors.map((color) => (
            <div key={color} className="flex items-center justify-between gap-3 px-3 py-2 bg-bg-elev rounded-md">
              <span className="text-[13px] font-medium">{color}</span>
              <Button size="sm" variant="secondary">✦ Generate {color}</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
