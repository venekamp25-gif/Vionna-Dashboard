"use client";

import { useState } from "react";
import { CompetitorPreview } from "@/components/review/CompetitorPreview";
import { ProductInfoCard } from "@/components/review/ProductInfoCard";
import { GeneratedContentCard } from "@/components/review/GeneratedContentCard";
import { ColorVariantsCard } from "@/components/review/ColorVariantsCard";
import { ImagesCard } from "@/components/review/ImagesCard";
import { NanoBananaSteps } from "@/components/review/NanoBananaSteps";
import { PublishPoolCard } from "@/components/review/PublishPoolCard";
import { StoreTabs } from "@/components/review/StoreTabs";
import { PublishProgressScreen } from "@/components/review/PublishProgressScreen";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useStep } from "@/lib/step";
import { useProduct, PublishResult, colorLabelFor } from "@/lib/product";
import { useStore, StoreKey, STORE_CONFIG } from "@/lib/store";
import { api } from "@/lib/api";
import { calcComparePrice } from "@/lib/pricing";

export function ReviewStep() {
  const { setStep } = useStep();
  const { data, patch, setData, syncActiveView } = useProduct();
  const { setStore } = useStore();
  const [publishing, setPublishing] = useState(false);
  const [publishingStore, setPublishingStore] = useState<StoreKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPoolImages = data.publishPool.filter((p) => p.selected);
  const targetStores = data.selectedStores.length ? data.selectedStores : (["dk"] as StoreKey[]);

  const publish = async () => {
    setError(null);

    // Validate publish pool
    if (selectedPoolImages.length === 0) {
      const ok = confirm("No photos selected in publish pool. Publish anyway (product will have no images)?");
      if (!ok) return;
    }

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
    }> = { dk: data.contentByStore.dk, fr: data.contentByStore.fr };
    snapshotByStore[data.activeViewStore] = {
      description: data.description,
      metaDescription: data.metaDescription,
      mTitleSpecs: data.mTitleSpecs,
      cutline: data.cutline,
      price: data.price,
      colorLabels: activeColorLabels,
    };

    setPublishing(true);
    const resultsByStore: Partial<Record<StoreKey, PublishResult>> = {};
    let lastResult: PublishResult | null = null;

    try {
      for (const store of targetStores) {
        setPublishingStore(store);
        const storeContent = snapshotByStore[store];

        // Build images_by_color using LOCALISED colour labels for THIS store
        const imagesByColor: Record<string, string[]> = { shared: [] };
        const imagesFlat: string[] = [];
        selectedPoolImages.forEach((p) => {
          const canonical = p.color || "shared";
          const localisedKey =
            canonical === "shared"
              ? "shared"
              : storeContent.colorLabels?.[canonical] ?? canonical;
          if (!imagesByColor[localisedKey]) imagesByColor[localisedKey] = [];
          imagesByColor[localisedKey].push(p.url);
          imagesFlat.push(p.url);
        });

        const localisedColors = data.canonicalColors.map(
          (c) => storeContent.colorLabels?.[c] ?? c
        );

        const storePrice = storeContent.price || data.price;
        const res = await api.publish({
          store,
          product_name: data.name,
          description: storeContent.description,
          meta_description: storeContent.metaDescription,
          m_title_specs: storeContent.mTitleSpecs,
          price: storePrice,
          compare_at_price: calcComparePrice(storePrice, data.discount),
          product_type: data.productType,
          colors: localisedColors,
          siblings_handle: data.siblingsHandle,
          images: Array.from(new Set(imagesFlat)),
          images_by_color: imagesByColor,
        });

        if (!res.success || res.error) {
          throw new Error(
            `${STORE_CONFIG[store].label}: ${res.error || "Unknown publish error"}`
          );
        }

        const storeResult: PublishResult = {
          productsCreated: res.products_created ?? 0,
          productUrls: res.product_urls ?? [],
          collectionUrl: res.collection_url ?? null,
          metafieldErrors: res.metafield_errors ?? [],
        };
        resultsByStore[store] = storeResult;
        lastResult = storeResult;
        // Push partial results to state immediately so the progress screen
        // updates the moment a store finishes (don't wait until the loop ends).
        setData((prev) => ({
          ...prev,
          publishResultsByStore: { ...resultsByStore },
          publishResult: lastResult,
        }));
      }

      // All stores published successfully
      setPublishingStore(null);
      // Show the first store's result by default
      setStore(targetStores[0]);
      setStep(4);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Persist any partial results so the user can see what succeeded
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
        publishingStore={publishingStore}
        resultsByStore={data.publishResultsByStore}
        error={error}
        onRetry={() => {
          setError(null);
          publish();
        }}
        onBack={() => {
          setError(null);
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
      <div className="sticky bottom-0 mt-8 -mx-8 lg:-mx-12 xl:-mx-16 px-8 lg:px-12 xl:px-16 py-4 bg-bg-elev border-t border-border backdrop-blur flex items-center justify-between gap-4">
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
                      .map((s) => STORE_CONFIG[s].label.replace("Vionna ", ""))
                      .join(" + ")})`}
                .
              </span>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(1)} disabled={publishing}>
            ← New product
          </Button>
          <Button variant="publish" onClick={publish} disabled={publishing}>
            {publishing
              ? "Publishing…"
              : targetStores.length === 1
              ? `Publish to ${STORE_CONFIG[targetStores[0]].label.replace("Vionna ", "")} →`
              : `Publish to ${targetStores.length} stores →`}
          </Button>
        </div>
      </div>
    </>
  );
}
