"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ImageTile } from "@/components/ui/ImageTile";
import { Lightbox } from "@/components/ui/Lightbox";
import { useProduct, NbResult, PoolPhoto } from "@/lib/product";
import { api } from "@/lib/api";

const STEPS = [
  { n: 1, title: "First model shot",      desc: "Product on model with reference background (4 variants)" },
  { n: 2, title: "Detailed model shot",   desc: "Full face + product details visible" },
  { n: 3, title: "Back view",             desc: "Same model, same background, back view" },
  { n: 4, title: "Close-up material",     desc: "Texture and detail shot of the material" },
];

const TOTAL_VARIANTS = 4;

export function NanoBananaSteps() {
  const { data, patch, setData } = useProduct();
  const [running, setRunning] = useState<Record<number, boolean>>({});
  const [progress, setProgress] = useState<Record<number, number>>({});
  const [stepErrors, setStepErrors] = useState<Record<number, string | null>>({});
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [runningColors, setRunningColors] = useState<Record<string, boolean>>({});

  /** Build reference image URLs for a given step based on current state. */
  const buildImageUrls = (step: number): string[] => {
    const urls: string[] = [];
    if (step === 1) {
      if (data.bgReferenceUrl) urls.push(data.bgReferenceUrl);
      const firstCompetitor = data.competitorImages.find((i) => i.selected);
      if (firstCompetitor) urls.push(firstCompetitor.url);
    } else if (step === 2) {
      if (data.pinnedUrl) urls.push(data.pinnedUrl);
      else (data.nbResults[1] ?? []).filter((r) => r.selected).forEach((r) => urls.push(r.url));
    } else if (step === 3 || step === 4) {
      if (data.pinnedUrl) urls.push(data.pinnedUrl);
      for (let s = 1; s < step; s++) {
        (data.nbResults[s] ?? []).filter((r) => r.selected).forEach((r) => {
          if (r.url !== data.pinnedUrl) urls.push(r.url);
        });
      }
    } else if (step === 5) {
      // For color variants: pinned model OR any selected NB image
      if (data.pinnedUrl) urls.push(data.pinnedUrl);
      else {
        for (let s = 4; s >= 1; s--) {
          const sel = (data.nbResults[s] ?? []).filter((r) => r.selected);
          if (sel.length) { urls.push(sel[0].url); break; }
        }
      }
    }
    return Array.from(new Set(urls));   // dedupe
  };

  /** Run one of the steps 1-4: 4 parallel API calls, each yields one image. */
  const runStep = async (stepNum: number) => {
    if (running[stepNum]) return;
    setRunning((r) => ({ ...r, [stepNum]: true }));
    setStepErrors((e) => ({ ...e, [stepNum]: null }));
    setProgress((p) => ({ ...p, [stepNum]: 0 }));

    const imageUrls = buildImageUrls(stepNum);

    // Reset slots — show 4 empty loading tiles immediately (functional → never overwrites a parallel step)
    setData((prev) => ({ ...prev, nbResults: { ...prev.nbResults, [stepNum]: [] } }));

    const slots: (NbResult | null)[] = Array(TOTAL_VARIANTS).fill(null);

    const calls = Array.from({ length: TOTAL_VARIANTS }, async (_, i) => {
      try {
        const res = await api.higgsfield({
          prompt_type: stepNum,
          product_type: data.productType || "dress",
          image_urls: imageUrls,
          count: 1,
        });
        const url = res.urls?.[0];
        if (!url) throw new Error(res.error ?? "No image returned");
        slots[i] = { url, selected: false };
      } catch {
        slots[i] = null;
      } finally {
        setProgress((p) => ({ ...p, [stepNum]: (p[stepNum] ?? 0) + 1 }));
        const partial = slots.map((s) => s ?? { url: "", selected: false });
        setData((prev) => ({ ...prev, nbResults: { ...prev.nbResults, [stepNum]: partial } }));
      }
    });

    await Promise.allSettled(calls);

    const finalResults = slots.filter((s): s is NbResult => s !== null);
    setData((prev) => ({ ...prev, nbResults: { ...prev.nbResults, [stepNum]: finalResults } }));

    if (finalResults.length === 0) {
      setStepErrors((e) => ({ ...e, [stepNum]: "All variants failed. Check Higgsfield + try again." }));
    }
    setRunning((r) => ({ ...r, [stepNum]: false }));
  };

  /** Regenerate just one slot. */
  const regenerateSlot = async (stepNum: number, slotIndex: number) => {
    const current = data.nbResults[stepNum] ?? [];
    const tile = current[slotIndex];
    if (!tile) return;

    // Remove from publish pool if selected
    if (tile.selected) {
      setData((prev) => ({ ...prev, publishPool: prev.publishPool.filter((p) => p.url !== tile.url) }));
    }

    const imageUrls = buildImageUrls(stepNum);
    const placeholder = { url: "", selected: false };
    setData((prev) => {
      const cur = prev.nbResults[stepNum] ?? [];
      const next = cur.map((r, i) => (i === slotIndex ? placeholder : r));
      return { ...prev, nbResults: { ...prev.nbResults, [stepNum]: next } };
    });

    try {
      const res = await api.higgsfield({
        prompt_type: stepNum,
        product_type: data.productType || "dress",
        image_urls: imageUrls,
        count: 1,
      });
      const url = res.urls?.[0];
      if (!url) throw new Error(res.error ?? "No image returned");
      setData((prev) => {
        const cur = prev.nbResults[stepNum] ?? [];
        const next = cur.map((r, i) => (i === slotIndex ? { url, selected: false } : r));
        return { ...prev, nbResults: { ...prev.nbResults, [stepNum]: next } };
      });
    } catch {
      // Leave placeholder empty; user can retry
    }
  };

  /** Generate 4 variants for a specific color (step 5). Multiple colors can run in parallel. */
  const runColorVariant = async (color: string) => {
    if (runningColors[color]) return;
    setRunningColors((m) => ({ ...m, [color]: true }));

    const imageUrls = buildImageUrls(5);
    if (!imageUrls.length) {
      alert("Select an image in steps 1–4 first (or pin one as model).");
      setRunningColors((m) => ({ ...m, [color]: false }));
      return;
    }

    try {
      const res = await api.higgsfield({
        prompt_type: 5,
        product_type: data.productType || "dress",
        color,
        image_urls: imageUrls,
        count: 4,
      });
      if (res.error) throw new Error(res.error);
      const urls = res.urls ?? [];
      const results: NbResult[] = urls.map((u) => ({ url: u, selected: false }));
      setData((prev) => ({
        ...prev,
        nbResultsPerColor: { ...prev.nbResultsPerColor, [color]: results },
      }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Failed to generate ${color}: ${msg}`);
    } finally {
      setRunningColors((m) => ({ ...m, [color]: false }));
    }
  };

  /** Toggle selection on a tile. Uses functional setData so fast clicks don't lose state. */
  const toggleSelect = (stepNum: number, slotIndex: number, color = "shared") => {
    setData((prev) => {
      const isStep5 = stepNum === 5;
      const current = isStep5
        ? prev.nbResultsPerColor[color] ?? []
        : prev.nbResults[stepNum] ?? [];

      const tile = current[slotIndex];
      if (!tile || !tile.url) return prev;
      const willSelect = !tile.selected;

      const updated = current.map((r, i) => (i === slotIndex ? { ...r, selected: willSelect } : r));

      const tagPrefix = isStep5 ? `NB Step 5 — ${color}` : `NB Step ${stepNum}`;
      const pool: PoolPhoto[] = prev.publishPool.filter((p) => !p.label.startsWith(tagPrefix));
      updated.forEach((r, i) => {
        if (r.selected && r.url) {
          pool.push({
            url: r.url,
            label: `${tagPrefix}.${i + 1}`,
            color: isStep5 ? color : "shared",
            selected: true,
          });
        }
      });

      return isStep5
        ? { ...prev, nbResultsPerColor: { ...prev.nbResultsPerColor, [color]: updated }, publishPool: pool }
        : { ...prev, nbResults: { ...prev.nbResults, [stepNum]: updated }, publishPool: pool };
    });
  };

  const togglePin = (url: string) => {
    patch({ pinnedUrl: data.pinnedUrl === url ? null : url });
  };

  return (
    <div className="space-y-4 mt-2">
      {data.pinnedUrl && (
        <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-[10px] bg-warning/15 border border-warning/40 text-[12px] text-warning">
          <span>📌</span>
          <span className="flex-1">Model reference pinned — used in all next NB steps.</span>
          <button
            onClick={() => patch({ pinnedUrl: null })}
            className="px-2 py-1 rounded bg-warning/20 hover:bg-warning/30 text-[11px] font-semibold"
          >
            Unpin
          </button>
        </div>
      )}

      {STEPS.map(({ n, title, desc }) => {
        const results = data.nbResults[n] ?? [];
        const isRunning = !!running[n];
        const done = results.length > 0 && results.some((r) => r.url);
        const stepErr = stepErrors[n];
        const progPct = isRunning ? Math.round(((progress[n] ?? 0) / TOTAL_VARIANTS) * 100) : 0;

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
                disabled={isRunning}
              >
                {isRunning ? `⟳ ${progPct}%` : done ? "✦ Regenerate (4)" : "✦ Generate 4 variants"}
              </Button>
            </div>

            {stepErr && (
              <div className="mb-3 px-3 py-2 rounded-md bg-danger/15 text-danger text-[12px]">{stepErr}</div>
            )}

            {(isRunning || done) && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {(isRunning && results.length === 0
                  ? Array.from({ length: TOTAL_VARIANTS }, () => ({ url: "", selected: false }))
                  : results
                ).map((r, i) =>
                  r.url ? (
                    <ImageTile
                      key={i}
                      url={r.url}
                      label={`Variant ${i + 1}`}
                      selected={r.selected}
                      pinned={data.pinnedUrl === r.url}
                      onToggle={() => toggleSelect(n, i)}
                      onZoom={() => setZoomUrl(r.url)}
                      onPin={() => togglePin(r.url)}
                      onRegenerate={() => regenerateSlot(n, i)}
                    />
                  ) : (
                    <div
                      key={i}
                      className="aspect-[3/4] rounded-[10px] bg-gradient-to-br from-bg-elev to-bg-elev-3 animate-pulse flex items-center justify-center"
                    >
                      <span className="text-[11px] text-text-faint">Variant {i + 1}</span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Step 5: Color variants */}
      <Step5
        onGenerate={runColorVariant}
        runningColors={runningColors}
        toggleSelect={toggleSelect}
        togglePin={togglePin}
        onZoom={(url) => setZoomUrl(url)}
        onGenerateAll={async (colors) => {
          for (const color of colors) {
            if (data.nbResultsPerColor[color]?.length) continue;  // skip already-generated
            await runColorVariant(color);
          }
        }}
      />

      <Lightbox url={zoomUrl} onClose={() => setZoomUrl(null)} />
    </div>
  );
}

interface Step5Props {
  onGenerate: (color: string) => void;
  onGenerateAll: (colors: string[]) => Promise<void>;
  runningColors: Record<string, boolean>;
  toggleSelect: (step: number, slot: number, color: string) => void;
  togglePin: (url: string) => void;
  onZoom: (url: string) => void;
}

function Step5({ onGenerate, onGenerateAll, runningColors, toggleSelect, togglePin, onZoom }: Step5Props) {
  const { data } = useProduct();
  const otherColors = data.colors.slice(1);

  const hasModelImage =
    !!data.pinnedUrl ||
    Object.values(data.nbResults).some((arr) => arr.some((r) => r.selected));

  const anyRunning = Object.values(runningColors).some(Boolean);
  const pendingColors = otherColors.filter((c) => !data.nbResultsPerColor[c]?.length);
  const canGenerateAll = hasModelImage && pendingColors.length > 0 && !anyRunning;

  return (
    <div className="bg-bg-elev-2 border border-border rounded-[14px] p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="px-2 py-1 rounded text-[11px] font-bold tracking-wide uppercase bg-bg-elev text-text-dim">
          Step 5
        </span>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-text">Color variants</div>
          <div className="text-[11px] text-text-faint">Per color: same model + background, different color</div>
        </div>
        {otherColors.length > 0 && hasModelImage && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => onGenerateAll(pendingColors)}
            disabled={!canGenerateAll}
            title={
              anyRunning
                ? "Wait for current generation to finish"
                : pendingColors.length === 0
                ? "All colors already generated"
                : `Generate ${pendingColors.length} remaining colors one by one`
            }
          >
            {anyRunning
              ? "⟳ Running…"
              : pendingColors.length === 0
              ? "✓ All done"
              : `✦ Generate all (${pendingColors.length})`}
          </Button>
        )}
      </div>

      {!hasModelImage ? (
        <div className="px-4 py-3 rounded-md bg-bg-elev text-[12px] text-text-faint text-center">
          Select an image in steps 1–4 first (or pin one as model) to generate color variants.
        </div>
      ) : otherColors.length === 0 ? (
        <div className="px-4 py-3 rounded-md bg-bg-elev text-[12px] text-text-faint text-center">
          Only the primary color is in your list — no additional variants to generate.
        </div>
      ) : (
        <div className="space-y-4">
          {otherColors.map((color) => {
            const results = data.nbResultsPerColor[color] ?? [];
            const isRunning = !!runningColors[color];
            return (
              <div key={color} className="bg-bg-elev rounded-[10px] p-3">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-text">{color}</span>
                    {results.length > 0 && (
                      <span className="text-[10px] text-text-faint">({results.filter((r) => r.selected).length}/{results.length} selected)</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onGenerate(color)}
                    disabled={isRunning}
                  >
                    {isRunning ? "⟳ Generating…" : results.length ? "✦ Regenerate" : `✦ Generate ${color}`}
                  </Button>
                </div>

                {results.length > 0 && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {results.map((r, i) => (
                      <ImageTile
                        key={i}
                        url={r.url}
                        label={`${color} ${i + 1}`}
                        selected={r.selected}
                        pinned={data.pinnedUrl === r.url}
                        onToggle={() => toggleSelect(5, i, color)}
                        onZoom={() => onZoom(r.url)}
                        onPin={() => togglePin(r.url)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
