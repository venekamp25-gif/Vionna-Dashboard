"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Label, Input, Textarea } from "@/components/ui/Field";
import { useProduct } from "@/lib/product";
import { useStep } from "@/lib/step";
import { useStore, StoreKey, STORE_CONFIG, STORE_KEYS } from "@/lib/store";
import { api } from "@/lib/api";

const ALL_STORES: StoreKey[] = STORE_KEYS;

// How the dropshipper verdict was reached — shown as a small footnote in the warning.
const SHIPPING_SOURCE_LABEL: Record<string, string> = {
  structured: "the store's structured shipping data",
  policy: "the store's shipping policy",
  "policy-js": "the store's shipping policy",
  llm: "AI reading the policy text",
  "llm-sonnet": "AI reading the policy text",
  vision: "AI reading a policy screenshot",
};

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (diffSec < 60) return "just now";
    if (diffSec < 60 * 60) return `${Math.round(diffSec / 60)}m ago`;
    if (diffSec < 24 * 60 * 60) return `${Math.round(diffSec / 3600)}h ago`;
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "recently";
  }
}

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

function FlagFI() {
  return (
    <svg className="w-5 h-3.5 rounded-sm shadow-sm" viewBox="0 0 28 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="28" height="20" fill="#fff" />
      <rect x="8" width="4" height="20" fill="#003580" />
      <rect y="8" width="28" height="4" fill="#003580" />
    </svg>
  );
}

const FLAGS: Record<StoreKey, React.ReactNode> = {
  dk: <FlagDK />,
  fr: <FlagFR />,
  fi: <FlagFI />,
};

export function InputStep() {
  const {
    data, patch,
    hasSavedDraft, draftSource, draftSavedAt, restoreDraft, clearDraft,
  } = useProduct();
  const { setStep } = useStep();
  const { setStore } = useStore();

  // Dropshipper check at import: classify the source store's shipping policy and
  // warn before importing if it's NOT a confirmed dropshipper.
  const [checking, setChecking] = useState(false);
  const [shippingWarn, setShippingWarn] = useState<
    { label: string; detail: string; source: string; confidence: string } | null
  >(null);

  // For multi-store: at least one store's keywords must be set.
  // For single-store: that store's keywords field is the one to check.
  // (Both end up parsed at Generate time; empty keywords just means Claude
  // gets none — not a blocker, so we don't enforce it at the form level.)
  const canSubmit =
    data.competitorUrl.trim().length > 0 && data.selectedStores.length > 0;

  const setKeywordsForStore = (store: StoreKey, value: string) => {
    const isPrimary = store === data.selectedStores[0];
    patch({
      keywordsByStore: { ...data.keywordsByStore, [store]: value },
      // Keep the legacy mirror in sync with the primary store so anything that
      // still reads data.keywords / data.parsedKeywords keeps working.
      ...(isPrimary ? { keywords: value } : {}),
    });
  };

  const toggleStore = (store: StoreKey) => {
    const isSelected = data.selectedStores.includes(store);
    let next: StoreKey[];
    if (isSelected) {
      next = data.selectedStores.filter((s) => s !== store);
    } else {
      // Preserve canonical order (dk, fr)
      next = ALL_STORES.filter(
        (s) => data.selectedStores.includes(s) || s === store
      );
    }
    if (next.length === 0) return; // keep at least one selected
    patch({
      selectedStores: next,
      // If active view is no longer selected, fall back to first selected
      activeViewStore: next.includes(data.activeViewStore)
        ? data.activeViewStore
        : next[0],
    });
  };

  // The actual import: parse keywords, set primary store, advance to scrape/generate.
  const proceed = () => {
    const primary = data.selectedStores[0];

    // Parse per-store keywords. Each store sends its OWN array to /api/generate
    // so the Danish copy isn't seeded by French keywords (and vice versa).
    const parse = (raw: string) =>
      raw.split("\n").map((k) => k.trim()).filter(Boolean);
    const parsedByStore: Record<StoreKey, string[]> = { dk: [], fr: [], fi: [] };
    for (const s of ALL_STORES) {
      parsedByStore[s] = parse(data.keywordsByStore[s] ?? "");
    }
    // Legacy mirror = primary store's parsed list
    const parsedKeywords = parsedByStore[primary] ?? [];

    // Make the global useStore.store track the first selected store
    // so APIs like /api/names use the primary language until Review tabs override it.
    setStore(primary);

    patch({
      parsedKeywords,
      parsedKeywordsByStore: parsedByStore,
      keywords: data.keywordsByStore[primary] ?? "",
      activeViewStore: primary,
    });
    setStep(2);
  };

  // Gate: classify the source store first. Dropshipper → import straight through.
  // Eigen voorraad / Onbekend → warn (with which case) and let the user decide.
  const onSubmit = async () => {
    if (!canSubmit || checking) return;
    setChecking(true);
    try {
      const res = await api.classifyShipping(data.competitorUrl.trim());
      if (res.label === "Dropshipper") {
        proceed();
      } else {
        setShippingWarn({ label: res.label, detail: res.detail || "", source: res.source, confidence: res.confidence });
      }
    } catch {
      // Classifier unreachable → treat as 'unknown' so the user is still warned.
      setShippingWarn({ label: "Onbekend", detail: "", source: "none", confidence: "none" });
    } finally {
      setChecking(false);
    }
  };

  // If a draft was auto-saved in a previous session and the user lands here with
  // empty input, offer to resume.
  const handleResume = () => {
    restoreDraft();
    // After restoring, if the product has gone past the Generate stage,
    // jump straight to Review so the user lands where they left off.
    setTimeout(() => {
      const d = data;
      // Note: data is stale here (closure), but restoreDraft sets new state which
      // triggers a re-render. We use a microtask to read the latest by checking
      // localStorage one more time — simpler than threading the latest data.
      try {
        const raw = window.localStorage.getItem("vionna-dashboard:active-draft-v1");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.canonicalColors?.length > 0) {
            setStep(3);
            return;
          }
        }
      } catch {}
      // Otherwise leave the user on Input with the URL pre-filled
      void d;
    }, 0);
  };

  return (
    <div className="max-w-3xl mx-auto">
      {hasSavedDraft && (
        <div className="mb-4 flex items-start gap-3 px-4 py-3.5 rounded-[10px] bg-accent/15 border-2 border-accent shadow-[0_0_0_4px_var(--accent-soft)]">
          <span className="text-accent text-xl mt-0.5">↺</span>
          <div className="flex-1 text-[13px]">
            <div className="font-semibold text-text">Resume your previous work?</div>
            <div className="text-text-dim text-[12px] mt-0.5 leading-relaxed">
              {draftSource === "server"
                ? "Saved to the cloud — picks up across all your devices."
                : "Saved in this browser."}
              {draftSavedAt && (
                <span className="ml-1">
                  Last saved {formatRelative(draftSavedAt)}.
                </span>
              )}
              <div className="text-warning mt-1 text-[11px]">
                ⚠ Choose <strong>Resume</strong> or <strong>Discard</strong> before starting a new product —
                otherwise your saved work might be overwritten.
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={clearDraft}
              className="text-[11px] font-semibold tracking-wider uppercase px-3 py-1.5 rounded-md border border-border bg-bg-elev-2 text-text-dim hover:border-danger hover:text-danger"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleResume}
              className="text-[11px] font-semibold tracking-wider uppercase px-3 py-1.5 rounded-md bg-accent text-on-accent hover:bg-accent-hover"
            >
              Resume →
            </button>
          </div>
        </div>
      )}

      <Card title="Competitor product">
        <Field>
          <Label hint="(content auto-generated per selected store)">Publish to</Label>
          <div className="flex flex-wrap gap-2.5">
            {ALL_STORES.map((s) => {
              const checked = data.selectedStores.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStore(s)}
                  aria-pressed={checked}
                  className={[
                    "inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] border text-[13px] font-medium transition-all duration-150",
                    checked
                      ? "bg-accent/12 border-accent text-text shadow-[0_0_0_2px_var(--accent-soft)]"
                      : "bg-bg-elev-2 border-border text-text-dim hover:border-border-hover hover:text-text",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "w-4 h-4 rounded-[4px] border flex items-center justify-center text-[10px] font-bold transition-colors",
                      checked
                        ? "bg-accent border-accent text-on-accent"
                        : "bg-bg-elev border-border text-transparent",
                    ].join(" ")}
                  >
                    ✓
                  </span>
                  {FLAGS[s]}
                  {STORE_CONFIG[s].label}
                </button>
              );
            })}
          </div>
          {data.selectedStores.length > 1 && (
            <div className="text-[11px] text-text-faint mt-2">
              {data.selectedStores
                .map((s) => STORE_CONFIG[s].language)
                .join(" + ")}{" "}
              content will be generated separately. Images are shared.
            </div>
          )}
        </Field>

        <Field>
          <Label>Competitor URL</Label>
          <Input
            type="text"
            value={data.competitorUrl}
            onChange={(e) => patch({ competitorUrl: e.target.value })}
            placeholder="Paste competitor product URL here..."
          />
        </Field>

        {data.selectedStores.length <= 1 ? (
          <Field>
            <Label hint="(one per line, from Ubersuggest/Trends sheet)">Keywords</Label>
            <Textarea
              rows={6}
              value={data.keywordsByStore[data.selectedStores[0] ?? "dk"] ?? ""}
              onChange={(e) => setKeywordsForStore(data.selectedStores[0] ?? "dk", e.target.value)}
              placeholder={
                "Put keywords researched for this product here...\n(one per line, e.g. from Ubersuggest or Google Trends)"
              }
            />
          </Field>
        ) : (
          <>
            <div className="text-[11px] text-text-faint mb-2 leading-relaxed">
              Each store uses its own keyword list — language-specific SEO research goes in the matching box.
            </div>
            {data.selectedStores.map((s) => (
              <Field key={s}>
                <Label hint={`— used for ${STORE_CONFIG[s].language} content only`}>
                  <span className="inline-flex items-center gap-2">
                    {FLAGS[s]}
                    Keywords for {STORE_CONFIG[s].label}
                  </span>
                </Label>
                <Textarea
                  rows={5}
                  value={data.keywordsByStore[s] ?? ""}
                  onChange={(e) => setKeywordsForStore(s, e.target.value)}
                  placeholder={`Keywords in ${STORE_CONFIG[s].language}, one per line`}
                />
              </Field>
            ))}
          </>
        )}

        <Button onClick={onSubmit} disabled={!canSubmit || checking}>
          {checking ? "Checking source store…" : "Import & Generate →"}
        </Button>
      </Card>

      {/* Dropshipper warning — shown when the source store is NOT a confirmed dropshipper */}
      {shippingWarn && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setShippingWarn(null)}
        >
          <div
            className="w-full max-w-md bg-bg-elev border border-border rounded-2xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="text-2xl leading-none mt-0.5">⚠️</div>
              <div className="flex-1">
                <h3 className="text-[15px] font-semibold text-text">
                  {shippingWarn.label === "Eigen voorraad"
                    ? "Source doesn't look like a dropshipper"
                    : "Couldn't determine delivery time"}
                </h3>
                <p className="text-[13px] text-text-dim mt-1.5 leading-relaxed">
                  {shippingWarn.label === "Eigen voorraad" ? (
                    <>
                      This store has <strong>fast delivery
                      {shippingWarn.detail ? ` (${shippingWarn.detail})` : ""}</strong> — under 5
                      business days, so it&apos;s likely <strong>own stock</strong>, not a dropshipper.
                    </>
                  ) : (
                    <>
                      Couldn&apos;t find this store&apos;s delivery time (no readable shipping
                      info on the site) — it may not be a dropshipper.
                    </>
                  )}
                </p>
                {shippingWarn.source !== "none" && (
                  <p className="text-[11px] text-text-faint mt-2 italic">
                    Based on {SHIPPING_SOURCE_LABEL[shippingWarn.source] ?? "the shipping policy"}
                    {shippingWarn.confidence === "low" ? " — low confidence, worth a quick check." : "."}
                  </p>
                )}
                <p className="text-[12px] text-text-faint mt-2">Import anyway?</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <Button variant="secondary" size="sm" onClick={() => setShippingWarn(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setShippingWarn(null);
                  proceed();
                }}
              >
                Continue anyway →
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
