"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ImageTile } from "@/components/ui/ImageTile";
import { Lightbox } from "@/components/ui/Lightbox";
import { useProduct, NbResult, PoolPhoto } from "@/lib/product";
import { api } from "@/lib/api";
import { higgsfieldQueue } from "@/lib/concurrency";

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
      // For color variants: pinned model first, then competitor refs as color samples
      if (data.pinnedUrl) urls.push(data.pinnedUrl);
      else {
        for (let s = 4; s >= 1; s--) {
          const sel = (data.nbResults[s] ?? []).filter((r) => r.selected);
          if (sel.length) { urls.push(sel[0].url); break; }
        }
      }
      // Add selected competitor images as color references (so Higgsfield can match the color).
      data.competitorImages
        .filter((img) => img.selected)
        .slice(0, 3)
        .forEach((img) => urls.push(img.url));
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
        const res = await higgsfieldQueue.run(() => api.higgsfield({
          prompt_type: stepNum,
          product_type: data.productType || "dress",
          image_urls: imageUrls,
          count: 1,
        }));
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
      const res = await higgsfieldQueue.run(() => api.higgsfield({
        prompt_type: stepNum,
        product_type: data.productType || "dress",
        image_urls: imageUrls,
        count: 1,
      }));
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

  /**
   * Compute the list of (step, favourite reference) pairs used as input for Step 5.
   * Order = [1,2,3,4]; steps without a favourite are skipped.
   */
  const computeStepFavourites = (): { step: number; ref: string }[] => {
    const favouriteFor = (step: number): string | null => {
      const stepResults = data.nbResults[step] ?? [];
      if (data.pinnedUrl && stepResults.some((r) => r.url === data.pinnedUrl)) {
        return data.pinnedUrl;
      }
      const selected = stepResults.find((r) => r.selected);
      if (selected) return selected.url;
      if (data.pinnedUrl) return data.pinnedUrl;
      return null;
    };
    const out: { step: number; ref: string }[] = [];
    for (const step of [1, 2, 3, 4]) {
      const ref = favouriteFor(step);
      if (ref) out.push({ step, ref });
    }
    return out;
  };

  /**
   * Colour references for a given step-5 colour.
   * Priority: per-colour selection (data.colorRefsByColor[color])
   * Fallback: globally selected competitor images (legacy behaviour).
   */
  const competitorColorRefs = (color?: string) => {
    if (color) {
      const perColor = data.colorRefsByColor[color] ?? [];
      if (perColor.length) return perColor.slice(0, 3);
    }
    return data.competitorImages
      .filter((img) => img.selected)
      .slice(0, 3)
      .map((img) => img.url);
  };

  /**
   * Generate 4 variants for a specific color — one per step format (1, 2, 3, 4).
   * Each variant uses the favourite from that step as the framing/model reference,
   * plus the competitor color references for colour matching.
   * Multiple colors can run in parallel.
   */
  const runColorVariant = async (color: string) => {
    if (runningColors[color]) return;
    setRunningColors((m) => ({ ...m, [color]: true }));

    const colorRefs = competitorColorRefs(color);
    const stepFavourites = computeStepFavourites();

    if (stepFavourites.length === 0) {
      alert("Select at least one image in steps 1–4 first (or pin one as model).");
      setRunningColors((m) => ({ ...m, [color]: false }));
      return;
    }

    // Seed the slot with N empty placeholders so the UI immediately shows the
    // animate-pulse loading tiles (the grid only renders when results.length > 0).
    // Without this the tiles flash in only once the FIRST API call returns —
    // which made it look like fewer tiles were "loading" for some colours.
    const placeholders: NbResult[] = Array.from(
      { length: stepFavourites.length },
      () => ({ url: "", selected: false })
    );
    setData((prev) => ({
      ...prev,
      nbResultsPerColor: { ...prev.nbResultsPerColor, [color]: placeholders },
    }));

    // Fire one Higgsfield call per step-format in parallel
    const slots: (NbResult | null)[] = new Array(stepFavourites.length).fill(null);

    const calls = stepFavourites.map(async ({ step, ref }, i) => {
      try {
        const res = await higgsfieldQueue.run(() => api.higgsfield({
          prompt_type: 10 + step,   // 11, 12, 13, 14
          product_type: data.productType || "dress",
          color,
          image_urls: [ref, ...colorRefs],
          count: 1,
        }));
        const url = res.urls?.[0];
        if (!url) throw new Error(res.error ?? "No image returned");
        slots[i] = { url, selected: false };
      } catch {
        slots[i] = null;
      } finally {
        const partial = slots.map((s) => s ?? { url: "", selected: false });
        setData((prev) => ({
          ...prev,
          nbResultsPerColor: { ...prev.nbResultsPerColor, [color]: partial },
        }));
      }
    });

    await Promise.allSettled(calls);

    const finalResults = slots.filter((s): s is NbResult => s !== null);
    setData((prev) => ({
      ...prev,
      nbResultsPerColor: { ...prev.nbResultsPerColor, [color]: finalResults },
    }));

    if (finalResults.length === 0) {
      alert(`All formats failed for ${color}. Check Higgsfield and try again.`);
    }
    setRunningColors((m) => ({ ...m, [color]: false }));
  };

  /** Regenerate one tile for a specific color. Re-runs the same step-format that produced it. */
  const regenerateColorSlot = async (color: string, slotIndex: number) => {
    const stepFavourites = computeStepFavourites();
    const target = stepFavourites[slotIndex];
    if (!target) return;

    const colorRefs = competitorColorRefs(color);

    // Drop from publish pool if it was selected
    setData((prev) => {
      const current = prev.nbResultsPerColor[color] ?? [];
      const tile = current[slotIndex];
      let pool = prev.publishPool;
      if (tile?.selected && tile.url) {
        pool = pool.filter((p) => p.url !== tile.url);
      }
      const next = current.map((r, i) => (i === slotIndex ? { url: "", selected: false } : r));
      return {
        ...prev,
        nbResultsPerColor: { ...prev.nbResultsPerColor, [color]: next },
        publishPool: pool,
      };
    });

    try {
      const res = await higgsfieldQueue.run(() => api.higgsfield({
        prompt_type: 10 + target.step,
        product_type: data.productType || "dress",
        color,
        image_urls: [target.ref, ...colorRefs],
        count: 1,
      }));
      const url = res.urls?.[0];
      if (!url) throw new Error(res.error ?? "No image returned");
      setData((prev) => {
        const current = prev.nbResultsPerColor[color] ?? [];
        const next = current.map((r, i) => (i === slotIndex ? { url, selected: false } : r));
        return { ...prev, nbResultsPerColor: { ...prev.nbResultsPerColor, [color]: next } };
      });
    } catch {
      // Leave placeholder so user can retry
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
        onRegenerateSlot={regenerateColorSlot}
        onGenerateAll={async (colors) => {
          // Kick off ALL colours roughly in parallel, with a 1-second stagger so
          // we don't slam the backend with a thundering herd. Actual concurrency
          // is capped by `higgsfieldQueue` (MAX_CONCURRENT_HIGGSFIELD) — anything
          // beyond the cap waits its turn and dispatches the instant a slot opens.
          const pending = colors.filter((c) => !data.nbResultsPerColor[c]?.length);
          await Promise.all(
            pending.map(
              (color, i) =>
                new Promise<void>((resolve) => {
                  setTimeout(() => {
                    runColorVariant(color).finally(resolve);
                  }, i * 1000);
                })
            )
          );
        }}
      />

      <Lightbox url={zoomUrl} onClose={() => setZoomUrl(null)} />
    </div>
  );
}

interface Step5Props {
  onGenerate: (color: string) => void;
  onGenerateAll: (colors: string[]) => Promise<void>;
  onRegenerateSlot: (color: string, slot: number) => Promise<void>;
  runningColors: Record<string, boolean>;
  toggleSelect: (step: number, slot: number, color: string) => void;
  togglePin: (url: string) => void;
  onZoom: (url: string) => void;
}

function Step5({ onGenerate, onGenerateAll, onRegenerateSlot, runningColors, toggleSelect, togglePin, onZoom }: Step5Props) {
  const { data } = useProduct();
  // Canonical colour keys (English) — used to key nbResultsPerColor / colorRefsByColor / publishPool.
  // Display labels are looked up via data.colors which mirrors the active view.
  const otherCanonical = data.canonicalColors.slice(1);
  const displayLabelFor = (canonical: string): string => {
    const idx = data.canonicalColors.indexOf(canonical);
    return idx >= 0 ? data.colors[idx] ?? canonical : canonical;
  };

  const hasModelImage =
    !!data.pinnedUrl ||
    Object.values(data.nbResults).some((arr) => arr.some((r) => r.selected));

  const anyRunning = Object.values(runningColors).some(Boolean);
  const pendingColors = otherCanonical.filter((c) => !data.nbResultsPerColor[c]?.length);
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
        {otherCanonical.length > 0 && hasModelImage && (
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
      ) : otherCanonical.length === 0 ? (
        <div className="px-4 py-3 rounded-md bg-bg-elev text-[12px] text-text-faint text-center">
          Only the primary color is in your list — no additional variants to generate.
        </div>
      ) : (
        <div className="space-y-4">
          {otherCanonical.map((canonical) => {
            const displayLabel = displayLabelFor(canonical);
            const results = data.nbResultsPerColor[canonical] ?? [];
            const isRunning = !!runningColors[canonical];
            return (
              <div key={canonical} className="bg-bg-elev rounded-[10px] p-3">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-text">{displayLabel}</span>
                    {displayLabel !== canonical && (
                      <span className="text-[10px] text-text-faint">({canonical})</span>
                    )}
                    {results.length > 0 && (
                      <span className="text-[10px] text-text-faint">({results.filter((r) => r.selected).length}/{results.length} selected)</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onGenerate(canonical)}
                    disabled={isRunning}
                  >
                    {isRunning ? "⟳ Generating…" : results.length ? "✦ Regenerate" : `✦ Generate ${displayLabel}`}
                  </Button>
                </div>

                <ColorRefPicker color={canonical} label={displayLabel} />

                {results.length > 0 && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {results.map((r, i) =>
                      r.url ? (
                        <ImageTile
                          key={i}
                          url={r.url}
                          label={`${displayLabel} ${i + 1}`}
                          selected={r.selected}
                          pinned={data.pinnedUrl === r.url}
                          onToggle={() => toggleSelect(5, i, canonical)}
                          onZoom={() => onZoom(r.url)}
                          onPin={() => togglePin(r.url)}
                          onRegenerate={() => onRegenerateSlot(canonical, i)}
                        />
                      ) : (
                        <div
                          key={i}
                          className="aspect-[3/4] rounded-[10px] bg-gradient-to-br from-bg-elev to-bg-elev-3 animate-pulse flex items-center justify-center"
                        >
                          <span className="text-[11px] text-text-faint">{displayLabel} {i + 1}</span>
                        </div>
                      )
                    )}
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

/**
 * Picker showing competitor thumbnails for ONE canonical colour.
 *
 * Source priority for the thumbnail list:
 *   1. `data.competitorImagesByColor[color]` — pre-computed at scrape time by
 *      grouping the FULL image set using a position-after-anchor heuristic
 *      (covers back / detail shots that the competitor didn't variant-tag).
 *   2. Fallback: filter the 8-image `competitorImages` cap by `variantIds`.
 *   3. Final fallback: show all 8 competitor images.
 */
function ColorRefPicker({ color, label }: { color: string; label?: string }) {
  const { data, setData } = useProduct();
  if (!data.competitorImages.length && !(data.competitorImagesByColor[color]?.length)) {
    return null;
  }

  const displayName = label ?? color;
  const selected = data.colorRefsByColor[color] ?? [];
  const isSelected = (url: string) => selected.includes(url);

  // Source 1: pre-grouped per-colour list from the FULL scraped images
  const grouped = data.competitorImagesByColor[color] ?? [];

  // Source 2: variant_ids filter on the 8 displayed competitor images
  const colorVariantIds = data.competitorVariantsByColor[color] ?? [];
  const variantSet = new Set(colorVariantIds);
  const tagged =
    variantSet.size > 0
      ? data.competitorImages
          .filter((img) => (img.variantIds ?? []).some((id) => variantSet.has(id)))
          .map((img) => img.url)
      : [];

  let visibleUrls: string[];
  let mode: "grouped" | "tagged" | "all";
  if (grouped.length > 0) {
    visibleUrls = grouped;
    mode = "grouped";
  } else if (tagged.length > 0) {
    visibleUrls = tagged;
    mode = "tagged";
  } else {
    visibleUrls = data.competitorImages.map((img) => img.url);
    mode = "all";
  }

  const toggle = (url: string) => {
    setData((prev) => {
      const cur = prev.colorRefsByColor[color] ?? [];
      const next = cur.includes(url) ? cur.filter((u) => u !== url) : [...cur, url];
      return { ...prev, colorRefsByColor: { ...prev.colorRefsByColor, [color]: next } };
    });
  };

  const visibleSelectedCount = visibleUrls.filter(isSelected).length;
  const sourceNote =
    mode === "all"
      ? colorVariantIds.length === 0
        ? " — competitor has no variant for this colour, showing all"
        : " — no images tagged to this colour, showing all"
      : ` — only ${displayName} variant photos`;

  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wider text-text-faint mb-1.5 flex items-center gap-1.5">
        Colour references for {displayName}
        <span className="text-text-faint/70 normal-case tracking-normal">
          ({visibleSelectedCount} of {visibleUrls.length} picked{sourceNote}
          {visibleSelectedCount === 0 ? "; using globally selected as fallback" : ""})
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {visibleUrls.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => toggle(url)}
            title={`${displayName} ${i + 1} — click to ${isSelected(url) ? "remove from" : "use as"} color reference`}
            className={[
              "flex-shrink-0 w-12 h-16 rounded-md overflow-hidden border-2 transition-all duration-150 relative",
              isSelected(url)
                ? "border-accent shadow-[0_0_0_2px_var(--accent-soft)]"
                : "border-border opacity-50 hover:opacity-100 hover:border-border-hover",
            ].join(" ")}
          >
            <img
              src={url}
              alt={`${displayName} ${i + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {isSelected(url) && (
              <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-accent text-on-accent text-[9px] font-bold flex items-center justify-center">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
