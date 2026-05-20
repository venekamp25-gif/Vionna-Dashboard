"use client";

import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { PublishResult } from "@/lib/product";
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

export type StoreStepStatus = "pending" | "publishing" | "done" | "failed";

interface Props {
  productName: string;
  colorCount: number;
  stores: StoreKey[];
  publishingStore: StoreKey | null;
  resultsByStore: Partial<Record<StoreKey, PublishResult>>;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
}

/**
 * Full-screen progress UI shown between Review and Publish-Done.
 * Tracks per-store state (pending / publishing / done / failed) and shows a
 * live progress bar. On error, offers Back-to-review + Retry buttons.
 */
export function PublishProgressScreen({
  productName,
  colorCount,
  stores,
  publishingStore,
  resultsByStore,
  error,
  onRetry,
  onBack,
}: Props) {
  const statusFor = (store: StoreKey): StoreStepStatus => {
    if (resultsByStore[store]) return "done";
    if (publishingStore === store) return "publishing";
    if (error && !publishingStore) {
      // Errored mid-loop: stores that didn't complete are marked failed (the
      // one that was actively publishing when it threw) or pending (later ones).
      // Heuristic: if any subsequent store has a result, this one was earlier.
      // Without per-store error tags we just mark "pending" for non-actives.
      return "pending";
    }
    return "pending";
  };

  const doneCount = stores.filter((s) => !!resultsByStore[s]).length;
  const totalCount = stores.length;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-bg-elev border border-border rounded-2xl px-8 py-12 flex flex-col items-center gap-6 text-center shadow-md">
        {error ? (
          <div className="w-12 h-12 rounded-full bg-danger/20 text-danger text-2xl flex items-center justify-center">!</div>
        ) : (
          <Spinner size={48} />
        )}

        <div className="flex flex-col gap-1">
          <h2 className="text-[16px] font-semibold text-text">
            {error
              ? "Publish failed"
              : doneCount === totalCount && totalCount > 0
              ? "Finishing up…"
              : "Publishing to Shopify"}
          </h2>
          <p className="text-[12px] text-text-faint">
            {error ? (
              <>You can retry, or go back to Review and adjust.</>
            ) : (
              <>
                Creating <strong className="text-text-dim">{productName}</strong> · {colorCount}{" "}
                {colorCount === 1 ? "colour duplicate" : "colour duplicates"} per store · linking siblings
                collection. Keep this tab open.
              </>
            )}
          </p>
        </div>

        {/* Per-store status rows */}
        <div className="w-full max-w-md flex flex-col gap-2">
          {stores.map((store) => {
            const status = statusFor(store);
            const result = resultsByStore[store];
            return (
              <div
                key={store}
                className={[
                  "flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] border transition-colors",
                  status === "publishing"
                    ? "bg-accent/8 border-accent/40"
                    : status === "done"
                    ? "bg-bg-elev-2 border-border"
                    : "bg-bg-elev-2 border-border",
                ].join(" ")}
              >
                <div className="shrink-0">{FLAGS[store]}</div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[13px] font-medium text-text">
                    {STORE_CONFIG[store].label}
                  </div>
                  <div className="text-[11px] text-text-faint truncate">
                    {status === "done"
                      ? `✓ ${result?.productsCreated ?? colorCount} ${
                          (result?.productsCreated ?? colorCount) === 1 ? "duplicate" : "duplicates"
                        } created · collection linked`
                      : status === "publishing"
                      ? `Creating ${colorCount} ${
                          colorCount === 1 ? "duplicate" : "duplicates"
                        } + siblings collection…`
                      : status === "failed"
                      ? "Failed"
                      : "Waiting…"}
                  </div>
                </div>
                <StatusBadge status={status} />
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        {!error && (
          <div className="w-full max-w-xs">
            <div className="h-1 rounded-full bg-bg-elev-2 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[11px] text-text-faint mt-1.5">
              {doneCount} of {totalCount} {totalCount === 1 ? "store" : "stores"} complete
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

function StatusBadge({ status }: { status: StoreStepStatus }) {
  if (status === "publishing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent shrink-0">
        <Spinner size={12} />
        Publishing
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent shrink-0">
        ✓ Done
      </span>
    );
  }
  if (status === "failed") {
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
