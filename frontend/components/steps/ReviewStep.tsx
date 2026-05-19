"use client";

import { useState } from "react";
import { CompetitorPreview } from "@/components/review/CompetitorPreview";
import { ProductInfoCard } from "@/components/review/ProductInfoCard";
import { GeneratedContentCard } from "@/components/review/GeneratedContentCard";
import { ColorVariantsCard } from "@/components/review/ColorVariantsCard";
import { ImagesCard } from "@/components/review/ImagesCard";
import { NanoBananaSteps } from "@/components/review/NanoBananaSteps";
import { PublishPoolCard } from "@/components/review/PublishPoolCard";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useStep } from "@/lib/step";
import { useProduct } from "@/lib/product";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { calcComparePrice } from "@/lib/pricing";

export function ReviewStep() {
  const { setStep } = useStep();
  const { data, patch } = useProduct();
  const { store } = useStore();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPoolImages = data.publishPool.filter((p) => p.selected);

  const publish = async () => {
    setError(null);

    // Validate publish pool
    if (selectedPoolImages.length === 0) {
      const ok = confirm("No photos selected in publish pool. Publish anyway (product will have no images)?");
      if (!ok) return;
    }

    setPublishing(true);

    // Build images_by_color from publishPool
    const imagesByColor: Record<string, string[]> = { shared: [] };
    const imagesFlat: string[] = [];
    selectedPoolImages.forEach((p) => {
      const key = p.color || "shared";
      if (!imagesByColor[key]) imagesByColor[key] = [];
      imagesByColor[key].push(p.url);
      imagesFlat.push(p.url);
    });

    try {
      const res = await api.publish({
        store,
        product_name: data.name,
        description: data.description,
        meta_description: data.metaDescription,
        m_title_specs: data.mTitleSpecs,
        price: data.price,
        compare_at_price: calcComparePrice(data.price, data.discount),
        product_type: data.productType,
        colors: data.colors,
        siblings_handle: data.siblingsHandle,
        images: Array.from(new Set(imagesFlat)),
        images_by_color: imagesByColor,
      });

      if (!res.success || res.error) {
        throw new Error(res.error || "Unknown publish error");
      }

      patch({
        publishResult: {
          productsCreated: res.products_created ?? 0,
          productUrls: res.product_urls ?? [],
          collectionUrl: res.collection_url ?? null,
          metafieldErrors: res.metafield_errors ?? [],
        },
      });
      setStep(4);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <CompetitorPreview />

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

      {/* Bottom bar (sticky) */}
      <div className="sticky bottom-0 mt-8 -mx-8 px-8 py-4 bg-bg-elev border-t border-border backdrop-blur flex items-center justify-between gap-4">
        <div className="flex flex-col">
          {error ? (
            <span className="text-[13px] text-danger">{error}</span>
          ) : publishing ? (
            <span className="text-[13px] text-text-dim flex items-center gap-2">
              <Spinner size={14} /> Publishing {data.colors.length} color {data.colors.length === 1 ? "duplicate" : "duplicates"} to Shopify…
            </span>
          ) : (
            <span className="text-[13px] text-text-dim">
              Review the details, then publish when ready.{" "}
              <span className="text-text-faint">
                {selectedPoolImages.length} {selectedPoolImages.length === 1 ? "photo" : "photos"} in pool.
              </span>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(1)} disabled={publishing}>
            ← New product
          </Button>
          <Button variant="publish" onClick={publish} disabled={publishing}>
            {publishing ? "Publishing…" : "Publish to Shopify →"}
          </Button>
        </div>
      </div>
    </>
  );
}
