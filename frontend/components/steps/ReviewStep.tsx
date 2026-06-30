"use client";

import { useRef, useState } from "react";
import { CompetitorPreview } from "@/components/review/CompetitorPreview";
import { ProductInfoCard } from "@/components/review/ProductInfoCard";
import { GeneratedContentCard } from "@/components/review/GeneratedContentCard";
import { ColorVariantsCard } from "@/components/review/ColorVariantsCard";
import { ImagesCard } from "@/components/review/ImagesCard";
import { NanoBananaSteps } from "@/components/review/NanoBananaSteps";
import { PublishPoolCard } from "@/components/review/PublishPoolCard";
import { StoreTabs } from "@/components/review/StoreTabs";
import { PublishProgressScreen, StoreProgress } from "@/components/review/PublishProgressScreen";
import {
  buildPrePublishChecks,
  PrePublishChecklistPopup,
  CheckItem,
} from "@/components/review/PrePublishChecklist";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useStep } from "@/lib/step";
import { useProduct, PublishResult, colorLabelFor } from "@/lib/product";
import { useStore, StoreKey, STORE_CONFIG } from "@/lib/store";
import { api } from "@/lib/api";
import { calcComparePrice } from "@/lib/pricing";
import { useUsedNames } from "@/lib/useUsedNames";
import { useRecentHistory, findRecentDuplicate } from "@/lib/useRecentHistory";
import { notify, requestNotificationPermission } from "@/lib/notifications";

export function ReviewStep() {
  const { setStep } = useStep();
  const { data, patch, setData, syncActiveView, clearDraft } = useProduct();
  const { setStore } = useStore();
  const { takenLower: takenNamesLower } = useUsedNames();
  const { entries: recentHistory } = useRecentHistory(200);
  const [publishing, setPublishing] = useState(false);
  const [publishingStore, setPublishingStore] = useState<StoreKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Partial<Record<StoreKey, StoreProgress>>>({});
  const [confirmChecks, setConfirmChecks] = useState<CheckItem[] | null>(null);
  const publishStartedAt = useRef<number | null>(null);
  const [variantsCompleted, setVariantsCompleted] = useState(0);

  const selectedPoolImages = data.publishPool.filter((p) => p.selected);
  const targetStores = data.selectedStores.length ? data.selectedStores : (["dk"] as StoreKey[]);

  /**
   * Outer publish handler — runs the checklist first and shows the popup
   * if anything is flagged. The user clicks "Publish anyway" → we call
   * doPublish() which has the actual orchestration logic.
   */
  const publish = () => {
    setError(null);
    const checks = buildPrePublishChecks(data, targetStores, takenNamesLower);
    // Extra check: was this same product name JUST published? (within 7 days)
    // Catches accidental double-publishes when the publish flow errored halfway,
    // OR when the user resumes an old draft and forgets that already shipped.
    const dup = findRecentDuplicate(recentHistory, data.name, 7);
    if (dup) {
      let when = "recently";
      try {
        const hours = Math.round((Date.now() - new Date(dup.timestamp).getTime()) / 3600000);
        when = hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
      } catch {}
      checks.push({
        id: "duplicate-recent",
        label: `'${data.name}' was already published ${when}`,
        level: "warn",
        detail: `Store: ${dup.store.toUpperCase()}. Are you sure you want to publish again?`,
      });
    }
    const issues = checks.filter((c) => c.level !== "ok");
    if (issues.length > 0) {
      setConfirmChecks(checks);
      return;
    }
    void doPublish();
  };

  const doPublish = async () => {
    setConfirmChecks(null);

    // Persist any unsaved active-view edits into contentByStore (visual cleanup)
    syncActiveView();

    // Build a CLOSURE snapshot of per-store content NOW so we don't fight React's
    // async state flush. For the active store, the mirror fields are authoritative.
    const activeColorLabels: Record<string, string> = Object.fromEntries(
      data.canonicalColors.map((c, i) => [c, data.colors[i] ?? c])
    );
    const snapshotByStore: Record<StoreKey, {
      description: string;
      metaDescription: string;
      mTitleSpecs: string;
      cutline: string;
      price: string;
      colorLabels: Record<string, string>;
    }> = { ...data.contentByStore };
    snapshotByStore[data.activeViewStore] = {
      description: data.description,
      metaDescription: data.metaDescription,
      mTitleSpecs: data.mTitleSpecs,
      cutline: data.cutline,
      price: data.price,
      colorLabels: activeColorLabels,
    };

    void requestNotificationPermission();
    setPublishing(true);
    publishStartedAt.current = Date.now();
    setVariantsCompleted(0);

    // Seed per-store progress so all stores show up in the UI immediately
    const initialProgress: Partial<Record<StoreKey, StoreProgress>> = {};
    for (const store of targetStores) {
      initialProgress[store] = {
        state: "pending",
        currentColor: null,
        currentColorLabel: null,
        currentColorIndex: 0,
        totalColors: data.canonicalColors.length,
        completedColors: [],
        productUrls: [],
        collectionUrl: null,
        metafieldErrors: [],
      };
    }
    setProgress(initialProgress);

    const resultsByStore: Partial<Record<StoreKey, PublishResult>> = {};
    let lastResult: PublishResult | null = null;

    const updateProgress = (store: StoreKey, patch: Partial<StoreProgress>) =>
      setProgress((prev) => ({
        ...prev,
        [store]: { ...(prev[store] as StoreProgress), ...patch },
      }));

    try {
      for (const store of targetStores) {
        setPublishingStore(store);
        const storeContent = snapshotByStore[store];

        // Build images_by_color using CANONICAL keys (we look up per-color later).
        const imagesByCanonical: Record<string, string[]> = { shared: [] };
        selectedPoolImages.forEach((p) => {
          const key = p.color || "shared";
          if (!imagesByCanonical[key]) imagesByCanonical[key] = [];
          imagesByCanonical[key].push(p.url);
        });
        const sharedImages = imagesByCanonical.shared ?? [];

        const storePrice = storeContent.price || data.price;
        const compareAtPrice = calcComparePrice(storePrice, data.discount);

        // 1️⃣ Ensure siblings collection
        updateProgress(store, { state: "collection" });
        const startRes = await api.publishStartStore({
          store,
          product_name: data.name,
          siblings_handle: data.siblingsHandle,
        });
        if (!startRes.success || startRes.error) {
          throw new Error(
            `${STORE_CONFIG[store].label}: ${startRes.error || "Collection setup failed"}`
          );
        }
        const collectionId = startRes.collection_id ?? null;
        const actualHandle = startRes.actual_handle ?? data.siblingsHandle;
        updateProgress(store, { collectionUrl: startRes.collection_url ?? null });

        // 2️⃣ Create one product per colour, in order
        const productUrls: string[] = [];
        const productIds: number[] = [];
        const allMetafieldErrors: string[] = [];
        const primaryCanonical = data.canonicalColors[0] ?? null;

        for (let i = 0; i < data.canonicalColors.length; i++) {
          const canonical = data.canonicalColors[i];
          const localisedLabel = storeContent.colorLabels?.[canonical] ?? canonical;
          updateProgress(store, {
            state: "variants",
            currentColor: canonical,
            currentColorLabel: localisedLabel,
            currentColorIndex: i,
          });

          // Images for this colour: shared (steps 1-4) + colour-specific (step 5)
          // Steps 1-4 photos depict the PRIMARY color only.
          const colorSpecific = imagesByCanonical[canonical] ?? [];
          const variantImages =
            canonical === primaryCanonical
              ? Array.from(new Set([...sharedImages, ...colorSpecific]))
              : Array.from(new Set(colorSpecific));

          const variantRes = await api.publishCreateVariant({
            store,
            product_name: data.name,
            color: localisedLabel,
            sizes: data.sizes,
            description: storeContent.description,
            meta_description: storeContent.metaDescription,
            m_title_specs: storeContent.mTitleSpecs,
            price: storePrice,
            compare_at_price: compareAtPrice,
            product_type: data.productType,
            images: variantImages,
            collection_id: collectionId,
            actual_handle: actualHandle,
            competitorUrl: data.competitorUrl,
            size_chart: data.sizeChart,
          });

          if (!variantRes.success || variantRes.error) {
            throw new Error(
              `${STORE_CONFIG[store].label} · ${localisedLabel}: ${variantRes.error || "Variant create failed"}`
            );
          }

          if (variantRes.product_url) productUrls.push(variantRes.product_url);
          if (variantRes.product_id) productIds.push(variantRes.product_id);
          if (variantRes.metafield_errors?.length)
            allMetafieldErrors.push(...variantRes.metafield_errors);

          // Functional updater so we don't read a stale `progress` from closure
          // — both stores' progress can be updating in parallel-ish order.
          setProgress((prev) => {
            const cur = prev[store] as StoreProgress | undefined;
            if (!cur) return prev;
            const completed = cur.completedColors.includes(canonical)
              ? cur.completedColors
              : [...cur.completedColors, canonical];
            return {
              ...prev,
              [store]: { ...cur, completedColors: completed, productUrls: [...productUrls] },
            };
          });
          setVariantsCompleted((n) => n + 1);
        }

        // 3️⃣ Store done
        const storeResult: PublishResult = {
          productsCreated: productUrls.length,
          productUrls,
          collectionUrl: startRes.collection_url ?? null,
          metafieldErrors: allMetafieldErrors,
          productIds,
        };
        resultsByStore[store] = storeResult;
        lastResult = storeResult;
        updateProgress(store, {
          state: "done",
          metafieldErrors: allMetafieldErrors,
          productUrls,
        });
        setData((prev) => ({
          ...prev,
          publishResultsByStore: { ...resultsByStore },
          publishResult: lastResult,
        }));

        // Post-publish verification — re-read the created products and confirm
        // images / cutline / channels / variants. Best-effort + informational:
        // never blocks the success flow if it errors.
        if (productIds.length) {
          try {
            const v = await api.verifyProducts(store, productIds);
            storeResult.verification = v.products;
            resultsByStore[store] = { ...storeResult };
            setData((prev) => ({ ...prev, publishResultsByStore: { ...resultsByStore } }));
          } catch {
            /* verification is informational — ignore failures */
          }
        }
      }

      // All stores published successfully — drop the auto-saved draft
      clearDraft();
      notify(
        `${data.name} published`,
        `${data.canonicalColors.length} colour duplicates × ${targetStores.length} ${targetStores.length === 1 ? "store" : "stores"}.`,
        "publish-done"
      );
      setPublishingStore(null);
      setStore(targetStores[0]);
      setStep(4);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Mark the currently-publishing store as failed for the progress UI
      if (publishingStore) {
        updateProgress(publishingStore, { state: "failed" });
      }
      if (Object.keys(resultsByStore).length > 0) {
        patch({ publishResultsByStore: resultsByStore, publishResult: lastResult });
      }
      setError(msg);
    } finally {
      setPublishing(false);
      setPublishingStore(null);
    }
  };

  // Used by tab switcher: also sync useStore.store so name validation etc. work
  const onTabChange = (store: StoreKey) => {
    setStore(store);
  };

  // Live preview of localised colour for the current active view (used in subtitle)
  const activeColors = data.canonicalColors.map((c) =>
    colorLabelFor(data, c, data.activeViewStore)
  );

  // Full-screen progress UI between Review and the Done step.
  // Shown while publishing OR after a publish error (so the user can retry/back).
  if (publishing || error) {
    return (
      <PublishProgressScreen
        productName={data.name || "this product"}
        colorCount={data.canonicalColors.length}
        stores={targetStores}
        progress={progress}
        startedAt={publishStartedAt.current}
        variantsCompleted={variantsCompleted}
        error={error}
        prepareMeta={!!data.prepareMeta}
        onRetry={() => {
          setError(null);
          publish();
        }}
        onBack={() => {
          setError(null);
          setProgress({});
        }}
      />
    );
  }

  return (
    <>
      <CompetitorPreview />

      {targetStores.length > 1 && (
        <StoreTabs
          stores={targetStores}
          onChange={onTabChange}
          publishingStore={publishingStore}
        />
      )}

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

      {/* Bottom bar (sticky) — bleeds to viewport edges via negative margin matching parent padding */}
      <div className="sticky bottom-0 z-20 mt-8 -mx-8 lg:-mx-12 xl:-mx-16 px-8 lg:px-12 xl:px-16 py-4 bg-bg-elev border-t border-border backdrop-blur flex items-center justify-between gap-4">
        <div className="flex flex-col">
          {error ? (
            <span className="text-[13px] text-danger">{error}</span>
          ) : publishing ? (
            <span className="text-[13px] text-text-dim flex items-center gap-2">
              <Spinner size={14} />
              {publishingStore ? (
                <>
                  Publishing to{" "}
                  <strong className="text-text">{STORE_CONFIG[publishingStore].label}</strong>
                  {" "}({activeColors.length} {activeColors.length === 1 ? "duplicate" : "duplicates"})…
                </>
              ) : (
                "Publishing…"
              )}
            </span>
          ) : (
            <span className="text-[13px] text-text-dim">
              Review the details, then publish when ready.{" "}
              <span className="text-text-faint">
                {selectedPoolImages.length}{" "}
                {selectedPoolImages.length === 1 ? "photo" : "photos"} in pool ·{" "}
                {targetStores.length === 1
                  ? `1 store (${STORE_CONFIG[targetStores[0]].label})`
                  : `${targetStores.length} stores (${targetStores
                      .map((s) => STORE_CONFIG[s].label.replace("Store ", ""))
                      .join(" + ")})`}
                .
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label
            className="flex items-center gap-2 cursor-pointer select-none text-[12px] text-text-dim hover:text-text"
            title="Bereid na publiceren PAUSED Meta Ads-campagnes voor (per kleur). Niks gaat live."
          >
            <input
              type="checkbox"
              checked={!!data.prepareMeta}
              onChange={(e) => patch({ prepareMeta: e.target.checked })}
              disabled={publishing}
              className="h-4 w-4 accent-[var(--accent)] cursor-pointer"
            />
            <span className="whitespace-nowrap">📣 Prepare Meta&nbsp;Ads</span>
          </label>
          <Button
            variant="secondary"
            onClick={() => {
              // Warn before tossing in-progress work (NB photos / pool selections).
              const hasNbWork =
                Object.values(data.nbResults).some((arr) => (arr ?? []).some((r) => r.url)) ||
                Object.values(data.nbResultsPerColor).some((arr) => (arr ?? []).some((r) => r.url));
              const hasPool = data.publishPool.length > 0;
              if ((hasNbWork || hasPool) &&
                  !confirm(
                    "You have generated photos that haven't been published yet. " +
                    "Going back to Input will keep the current product loaded, " +
                    "but you'll lose your progress if you start a new scrape. " +
                    "Continue?"
                  )) {
                return;
              }
              setStep(1);
            }}
            disabled={publishing}
          >
            ← New product
          </Button>
          <Button variant="publish" onClick={publish} disabled={publishing}>
            {publishing
              ? "Publishing…"
              : targetStores.length === 1
              ? `Publish to ${STORE_CONFIG[targetStores[0]].label.replace("Store ", "")} →`
              : `Publish to ${targetStores.length} stores →`}
          </Button>
        </div>
      </div>

      <PrePublishChecklistPopup
        open={confirmChecks !== null}
        checks={confirmChecks ?? []}
        onCancel={() => setConfirmChecks(null)}
        onPublishAnyway={() => doPublish()}
      />
    </>
  );
}
