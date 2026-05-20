"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Label, Input, Textarea } from "@/components/ui/Field";
import { useProduct } from "@/lib/product";
import { useStep } from "@/lib/step";
import { useStore, StoreKey, STORE_CONFIG } from "@/lib/store";

const ALL_STORES: StoreKey[] = ["dk", "fr"];

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

const FLAGS: Record<StoreKey, React.ReactNode> = {
  dk: <FlagDK />,
  fr: <FlagFR />,
};

export function InputStep() {
  const { data, patch } = useProduct();
  const { setStep } = useStep();
  const { setStore } = useStore();

  const canSubmit =
    data.competitorUrl.trim().length > 0 && data.selectedStores.length > 0;

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

  const onSubmit = () => {
    if (!canSubmit) return;
    // Parse keywords into array for downstream steps
    const parsedKeywords = data.keywords
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);

    // Make the global useStore.store track the first selected store
    // so APIs like /api/names use the primary language until Review tabs override it.
    const primary = data.selectedStores[0];
    setStore(primary);

    patch({
      parsedKeywords,
      activeViewStore: primary,
    });
    setStep(2);
  };

  return (
    <div className="max-w-3xl mx-auto">
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

        <Field>
          <Label hint="(one per line, from Ubersuggest/Trends sheet)">Keywords</Label>
          <Textarea
            rows={6}
            value={data.keywords}
            onChange={(e) => patch({ keywords: e.target.value })}
            placeholder={
              "Put keywords researched for this product here...\n(one per line, e.g. from Ubersuggest or Google Trends)"
            }
          />
        </Field>

        <Button onClick={onSubmit} disabled={!canSubmit}>
          Import &amp; Generate →
        </Button>
      </Card>
    </div>
  );
}
