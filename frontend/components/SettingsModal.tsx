"use client";

import { useEffect, useState } from "react";
import { useToneReferences, ToneReferences } from "@/lib/toneReference";
import { StoreKey, STORE_CONFIG, STORE_KEYS } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { useProduct } from "@/lib/product";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Dashboard settings — currently houses the per-store Tone Reference editor.
 * Tone references are example descriptions from your own catalogue that Claude
 * uses as a style anchor on every generation, so newly written content
 * matches your existing voice instead of sounding generic.
 */
export function SettingsModal({ open, onClose }: Props) {
  const { refs, update } = useToneReferences();
  const { clearDraft } = useProduct();
  const [draft, setDraft] = useState<ToneReferences>({ dk: [], fr: [], fi: [] });
  const [activeTab, setActiveTab] = useState<StoreKey>("dk");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const handleResetDraft = () => {
    if (!confirm(
      "Discard the current product and wipe the saved draft (both in this browser AND on the cloud)? " +
      "This cannot be undone."
    )) return;
    clearDraft();
    // Soft reload so the in-memory state resets too
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  // Sales-channel backfill state
  type ChannelResult = Awaited<ReturnType<typeof api.backfillSalesChannels>>;
  const [backfillBusy, setBackfillBusy] = useState<StoreKey | null>(null);
  const [backfillResult, setBackfillResult] = useState<
    Partial<Record<StoreKey, ChannelResult>>
  >({});

  const runBackfill = async (store: StoreKey) => {
    setBackfillBusy(store);
    try {
      const res = await api.backfillSalesChannels(store);
      setBackfillResult((r) => ({ ...r, [store]: res }));
    } catch (e) {
      setBackfillResult((r) => ({
        ...r,
        [store]: {
          store, targets: [], successes: 0, failures_count: 0, failures: [],
          error: e instanceof Error ? e.message : String(e),
        } as ChannelResult,
      }));
    } finally {
      setBackfillBusy(null);
    }
  };

  // Re-sync the local draft each time the modal opens (so cancel works)
  useEffect(() => {
    if (open) {
      setDraft({ dk: [...refs.dk], fr: [...refs.fr], fi: [...refs.fi] });
    }
  }, [open, refs]);

  if (!open) return null;

  const examples = draft[activeTab];
  const updateExample = (idx: number, value: string) => {
    const next = [...examples];
    next[idx] = value;
    setDraft({ ...draft, [activeTab]: next });
  };
  const removeExample = (idx: number) => {
    const next = examples.filter((_, i) => i !== idx);
    setDraft({ ...draft, [activeTab]: next });
  };
  const addExample = () => {
    setDraft({ ...draft, [activeTab]: [...examples, ""] });
  };

  const handleFetchFromShopify = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const r = await api.recentDescriptions({ store: activeTab, limit: 3 });
      if (r.error) throw new Error(r.error);
      const fetched = (r.items ?? []).map((i) => i.description).filter(Boolean);
      if (fetched.length === 0) {
        setFetchError("No active products with descriptions found in this store.");
        return;
      }
      // Replace the active store's examples with the freshly fetched ones
      setDraft({ ...draft, [activeTab]: fetched });
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  const handleSave = () => {
    // Strip empty entries and trim
    const cleaned: ToneReferences = {
      dk: draft.dk.map((s) => s.trim()).filter(Boolean),
      fr: draft.fr.map((s) => s.trim()).filter(Boolean),
      fi: draft.fi.map((s) => s.trim()).filter(Boolean),
    };
    update(cleaned);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-16 px-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-bg-elev border border-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-[16px] font-semibold text-text">Settings</h2>
            <p className="text-[11px] text-text-faint mt-0.5">
              Tone reference — example descriptions from your own catalogue, used as a style anchor when Claude writes new content.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-faint hover:text-text text-xl px-2"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Tabs per store */}
          <div className="inline-flex bg-bg-elev-2 rounded-lg p-[3px] gap-[2px] mb-4">
            {STORE_KEYS.map((s) => {
              const active = s === activeTab;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActiveTab(s)}
                  className={[
                    "px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-all",
                    active
                      ? "bg-accent text-on-accent shadow-sm"
                      : "text-text-dim hover:text-text",
                  ].join(" ")}
                >
                  {STORE_CONFIG[s].label}
                  <span className="ml-2 text-[10px] opacity-70">
                    ({draft[s].filter(Boolean).length})
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-[12px] text-text-faint mb-3 leading-relaxed">
            Paste 1-3 product descriptions from your existing {STORE_CONFIG[activeTab].label} catalogue,
            or auto-fetch the 3 most recent active products from Shopify. Claude will mirror their
            length, tone and bullet structure when generating new content. Leave empty to use the
            default house style.
          </p>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleFetchFromShopify}
              disabled={fetching}
            >
              {fetching ? "Fetching…" : `↓ Fetch 3 recent from ${STORE_CONFIG[activeTab].label}`}
            </Button>
            {fetchError && (
              <span className="text-[11px] text-danger">{fetchError}</span>
            )}
          </div>

          {examples.length === 0 && (
            <div className="text-center py-8 px-4 rounded-[10px] bg-bg-elev-2/50 border border-dashed border-border">
              <p className="text-[13px] text-text-faint mb-3">
                No tone references for {STORE_CONFIG[activeTab].label} yet.
              </p>
              <Button variant="primary" size="sm" onClick={addExample}>
                + Add an example
              </Button>
            </div>
          )}

          {examples.map((ex, i) => (
            <div key={i} className="mb-4 last:mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-text-dim">
                  Example {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeExample(i)}
                  className="text-[11px] text-text-faint hover:text-danger px-2 py-0.5"
                >
                  Remove
                </button>
              </div>
              <textarea
                value={ex}
                onChange={(e) => updateExample(i, e.target.value)}
                rows={6}
                placeholder="Paste a full product description here…"
                className="w-full bg-bg-elev-2 border border-border rounded-[10px] px-3.5 py-2.5 text-[13px] text-text placeholder:text-text-faint hover:border-border-hover focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)] resize-y leading-relaxed"
              />
              <div className="text-[10px] text-text-faint mt-1 text-right">
                {ex.length} chars
              </div>
            </div>
          ))}

          {examples.length > 0 && examples.length < 3 && (
            <Button variant="secondary" size="sm" onClick={addExample}>
              + Add another example
            </Button>
          )}

          {/* ── Sales channels backfill ────────────────────────────── */}
          <div className="mt-8 pt-6 border-t border-border">
            <div className="text-[14px] font-semibold text-text mb-1">
              Sales channels
            </div>
            <p className="text-[12px] text-text-faint mb-3 leading-relaxed">
              Every newly imported product is automatically published to
              Online Store, Facebook and Google. Click the button below to
              also retroactively publish every <em>existing</em> product in
              your catalogue (active or draft) to the same three channels.
              Idempotent — products already on a channel are silently
              re-confirmed.
            </p>
            <div className="flex flex-wrap gap-2">
              {STORE_KEYS.map((s) => {
                const busy = backfillBusy === s;
                const result = backfillResult[s];
                return (
                  <div key={s} className="flex flex-col gap-1 min-w-[200px]">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => runBackfill(s)}
                      disabled={busy || backfillBusy !== null}
                    >
                      {busy
                        ? `⟳ Running on ${STORE_CONFIG[s].label}…`
                        : `↻ Backfill ${STORE_CONFIG[s].label}`}
                    </Button>
                    {result && (
                      <div className="text-[11px] leading-relaxed">
                        {result.error ? (
                          <span className="text-danger">
                            ✕ {result.error}
                            {result.available_publications && result.available_publications.length > 0 && (
                              <span className="block text-text-faint">
                                Available: {result.available_publications.join(", ")}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className={result.successes > 0 ? "text-accent" : "text-warning"}>
                            {result.successes > 0 ? "✓" : "⚠"} {result.successes} of{" "}
                            {result.successes + result.failures_count} products published to{" "}
                            {result.targets.join(", ")}
                            {result.failures_count > 0 && (
                              <span className="block text-warning mt-1">
                                ⚠ {result.failures_count} failed
                                {result.first_failure_error && (
                                  <span className="block text-danger mt-0.5 break-words">
                                    First error: {result.first_failure_error}
                                  </span>
                                )}
                                {result.error_summary && Object.keys(result.error_summary).length > 1 && (
                                  <span className="block text-text-faint mt-0.5">
                                    {Object.keys(result.error_summary).length} distinct error types
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Reset draft (escape hatch) ─────────────────────────── */}
          <div className="mt-6 pt-6 border-t border-border">
            <div className="text-[14px] font-semibold text-text mb-1">
              Reset draft
            </div>
            <p className="text-[12px] text-text-faint mb-3 leading-relaxed">
              Use this if the dashboard is stuck on a broken product state —
              clears the auto-saved draft from both your browser AND the cloud,
              then reloads the page. Won&apos;t affect anything already published to
              Shopify.
            </p>
            <Button variant="secondary" size="sm" onClick={handleResetDraft}>
              ✕ Discard current draft &amp; reload
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-bg-elev-2 rounded-b-2xl">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
