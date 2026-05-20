"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { StoreKey, STORE_CONFIG } from "@/lib/store";

function FlagDK() {
  return (
    <svg className="w-5 h-3.5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="28" height="20" fill="#C8102E" />
      <rect x="9" width="3" height="20" fill="#fff" />
      <rect y="8.5" width="28" height="3" fill="#fff" />
    </svg>
  );
}
function FlagFR() {
  return (
    <svg className="w-5 h-3.5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="9.33" height="20" fill="#002395" />
      <rect x="9.33" width="9.33" height="20" fill="#fff" />
      <rect x="18.66" width="9.34" height="20" fill="#ED2939" />
    </svg>
  );
}
const FLAGS: Record<StoreKey, React.ReactNode> = { dk: <FlagDK />, fr: <FlagFR /> };

/**
 * Live per-store progress, kept in ReviewStep and pushed down for rendering.
 *
 * state:
 *   "pending"    — not started yet
 *   "collection" — creating / reusing the siblings collection
 *   "variants"   — actively creating colour-variant products
 *   "done"       — all variants created, store complete
 *   "failed"     — something errored while this store was active
 */
export interface StoreProgress {
  state: "pending" | "collection" | "variants" | "done" | "failed";
  currentColor: string | null;        // canonical
  currentColorLabel: string | null;   // localised
  currentColorIndex: number;          // 0-based
  totalColors: number;
  completedColors: string[];          // canonical
  productUrls: string[];
  collectionUrl: string | null;
  metafieldErrors: string[];
}

interface Props {
  productName: string;
  colorCount: number;
  stores: StoreKey[];
  progress: Partial<Record<StoreKey, StoreProgress>>;
  /** Wall-clock ms when publishing started. Used to compute ETA. */
  startedAt: number | null;
  /** Total variants finished across ALL stores so far. */
  variantsCompleted: number;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
}

/**
 * Full-screen progress UI shown between Review and Publish-Done.
 * Renders one row per store with a nested progress bar showing each colour
 * duplicate's status, plus a current-step description and live ETA estimate.
 */
export function PublishProgressScreen({
  productName,
  colorCount,
  stores,
  progress,
  startedAt,
  variantsCompleted,
  error,
  onRetry,
  onBack,
}: Props) {
  // 1Hz heartbeat so the ETA text updates every second
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt || error) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt, error]);

  const totalVariants = stores.length * colorCount;
  const overallDone = stores.filter((s) => progress[s]?.state === "done").length;
  const overallProgressPct =
    totalVariants > 0 ? Math.min(100, (variantsCompleted / totalVariants) * 100) : 0;

  // ETA: average wall-clock-ms per completed variant × remaining variants
  let etaText = "";
  if (startedAt && variantsCompleted > 0 && variantsCompleted < totalVariants) {
    const elapsed = Date.now() - startedAt;
    const avgMs = elapsed / variantsCompleted;
    const remaining = totalVariants - variantsCompleted;
    const etaMs = Math.round(avgMs * remaining);
    etaText = `~${formatDuration(etaMs)} remaining`;
  } else if (startedAt && variantsCompleted === 0) {
    etaText = "Estimating…";
  }

  // Current-step description — pick the first store still actively publishing
  const activeStore = stores.find((s) => {
    const st = progress[s]?.state;
    return st === "collection" || st === "variants";
  });
  let stepText = "";
  if (activeStore) {
    const p = progress[activeStore]!;
    const flag = STORE_CONFIG[activeStore].label;
    if (p.state === "collection") {
      stepText = `${flag} · Creating siblings collection…`;
    } else if (p.state === "variants" && p.currentColorLabel) {
      stepText = `${flag} · Creating ${p.currentColorLabel} duplicate (${p.currentColorIndex + 1} of ${p.totalColors})…`;
    }
  } else if (!error && overallDone === stores.length && stores.length > 0) {
    stepText = "Wrapping up…";
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-bg-elev border border-border rounded-2xl px-8 py-12 flex flex-col items-center gap-6 text-center shadow-md">
        {error ? (
          <div className="w-12 h-12 rounded-full bg-danger/20 text-danger text-2xl flex items-center justify-center">!</div>
        ) : (
          <Spinner size={48} />
        )}

        <div className="flex flex-col gap-1 max-w-md">
          <h2 className="text-[16px] font-semibold text-text">
            {error
              ? "Publish failed"
              : overallDone === stores.length && stores.length > 0
              ? "Finishing up…"
              : "Publishing to Shopify"}
          </h2>
          <p className="text-[12px] text-text-faint leading-relaxed">
            {error ? (
              <>You can retry, or go back to Review and adjust.</>
            ) : (
              <>
                Creating <strong className="text-text-dim">{productName}</strong> · {colorCount}{" "}
                {colorCount === 1 ? "colour duplicate" : "colour duplicates"} per store.
                Keep this tab open.
              </>
            )}
          </p>
          {/* Live current-step subtitle */}
          {!error && stepText && (
            <p className="text-[12px] text-accent mt-2 font-medium animate-pulse">
              {stepText}
            </p>
          )}
        </div>

        {/* Per-store rows with nested per-colour progress */}
        <div className="w-full max-w-md flex flex-col gap-3">
          {stores.map((store) => {
            const p = progress[store];
            return (
              <StoreRow
                key={store}
                store={store}
                progress={p}
                colorCount={colorCount}
              />
            );
          })}
        </div>

        {/* Overall progress bar + ETA */}
        {!error && (
          <div className="w-full max-w-xs">
            <div className="h-1 rounded-full bg-bg-elev-2 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500 ease-out"
                style={{ width: `${overallProgressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-text-faint mt-1.5">
              <span>
                {variantsCompleted} of {totalVariants} duplicates
              </span>
              {etaText && <span>{etaText}</span>}
            </div>
          </div>
        )}

        {/* Error details + actions */}
        {error && (
          <div className="w-full max-w-md flex flex-col gap-3">
            <div className="px-3.5 py-3 rounded-md bg-danger/15 border border-danger/40 text-[12px] text-danger text-left">
              {error}
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={onBack}>
                ← Back to review
              </Button>
              <Button variant="primary" size="sm" onClick={onRetry}>
                ↻ Retry publish
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StoreRow({
  store,
  progress,
  colorCount,
}: {
  store: StoreKey;
  progress: StoreProgress | undefined;
  colorCount: number;
}) {
  const state = progress?.state ?? "pending";
  const done = progress?.completedColors.length ?? 0;
  const pct = colorCount > 0 ? (done / colorCount) * 100 : 0;

  let detail = "";
  if (state === "pending") {
    detail = "Waiting…";
  } else if (state === "collection") {
    detail = "Creating siblings collection…";
  } else if (state === "variants") {
    if (progress?.currentColorLabel) {
      detail = `Creating ${progress.currentColorLabel} (${progress.currentColorIndex + 1} of ${colorCount})`;
    } else {
      detail = "Creating duplicates…";
    }
  } else if (state === "done") {
    detail = `✓ ${done} ${done === 1 ? "duplicate" : "duplicates"} created · collection linked`;
  } else if (state === "failed") {
    detail = "Failed";
  }

  return (
    <div
      className={[
        "flex flex-col gap-2 px-3.5 py-3 rounded-[10px] border transition-colors text-left",
        state === "variants" || state === "collection"
          ? "bg-accent/8 border-accent/40"
          : state === "failed"
          ? "bg-danger/10 border-danger/40"
          : "bg-bg-elev-2 border-border",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0">{FLAGS[store]}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text">
            {STORE_CONFIG[store].label}
          </div>
          <div className="text-[11px] text-text-faint truncate">{detail}</div>
        </div>
        <StatusBadge state={state} />
      </div>

      {/* Per-colour mini-progress bar (visible while creating variants or after completion) */}
      {(state === "variants" || state === "done") && colorCount > 0 && (
        <div className="flex items-center gap-2 pl-8">
          <div className="flex-1 h-[3px] rounded-full bg-bg-elev overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] text-text-faint tabular-nums shrink-0">
            {done}/{colorCount}
          </span>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state: StoreProgress["state"] }) {
  if (state === "collection" || state === "variants") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent shrink-0">
        <Spinner size={12} />
        Publishing
      </span>
    );
  }
  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent shrink-0">
        ✓ Done
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger shrink-0">
        ✕ Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-faint shrink-0">
      ⋯ Waiting
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "1s";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (remSec === 0) return `${minutes}m`;
  return `${minutes}m ${remSec}s`;
}
