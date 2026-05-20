"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { useStep } from "@/lib/step";
import { useProduct, StoreContent } from "@/lib/product";
import { useStore, StoreKey, STORE_CONFIG } from "@/lib/store";
import { api } from "@/lib/api";
import {
  extractColors,
  extractVariantsByColor,
  groupImagesByColor,
  guessProductType,
  normalizeImageUrl,
  safeHostname,
} from "@/lib/scrape-utils";
import { translateColor } from "@/lib/colors";
import { randomName } from "@/lib/names";
import { autoSiblingsHandle } from "@/lib/slug";

type Stage = "scraping" | "names" | "generating" | "done";

const STAGE_LABELS: Record<Stage, { main: string; sub: string; pct: number }> = {
  scraping:   { main: "Fetching competitor product…",       sub: "Scraping product details",                          pct: 20 },
  names:      { main: "Generating product name…",           sub: "Checking uniqueness against Shopify catalogue",     pct: 40 },
  generating: { main: "Generating content via Claude…",     sub: "Style: calm, practical, comfort-oriented",          pct: 80 },
  done:       { main: "Preparing review…",                  sub: "Almost there",                                      pct: 100 },
};

/** Title-case a colour string for use as a canonical key. */
function canonicalize(color: string): string {
  const trimmed = color.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function GenerateStep() {
  const { setStep } = useStep();
  const { data, patch } = useProduct();
  const { setStore } = useStore();
  const [stage, setStage] = useState<Stage>("scraping");
  const [subStage, setSubStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const selectedStores = data.selectedStores.length
          ? data.selectedStores
          : (["dk"] as StoreKey[]);
        const primary = selectedStores[0];

        // ── 1. Scrape competitor product (ONCE — shared across stores) ──
        setStage("scraping");
        const scraped = await api.scrape(data.competitorUrl);
        if (scraped.error) throw new Error(scraped.error);
        const product = scraped.product;

        const competitor = {
          title: product?.title ?? "Unknown product",
          hostname: safeHostname(data.competitorUrl),
          variants: product?.variants?.length ?? 0,
          price: product?.variants?.[0]?.price ? `€${product.variants[0].price}` : "—",
        };
        const productType = guessProductType(product);
        const rawColors = extractColors(product);
        const canonicalColors = rawColors.map(canonicalize);

        // ImagesCard "From competitor" shows just 8 thumbnails — enough for the
        // user to pick a reference for steps 1-4. Nothing is pre-selected.
        const images = (product?.images ?? [])
          .slice(0, 8)
          .map((img) => ({
            url: normalizeImageUrl(img.src),
            selected: false,
            variantIds: img.variant_ids ?? [],
          }));

        const variantsByColor = extractVariantsByColor(product, canonicalColors);
        // Compute per-colour image groups from the FULL scraped image set so the
        // ColorRefPicker has every back/detail shot — not just the cap-of-8.
        const imagesByColor = groupImagesByColor(product, canonicalColors);

        // ── 2. Pick unique product name (checked against PRIMARY store's catalogue) ──
        setStage("names");
        let usedFromShopify: string[] = [];
        try {
          const r = await api.names(primary);
          usedFromShopify = r.names ?? [];
        } catch {
          // Non-fatal: continue with empty list
        }
        const lower = new Set(usedFromShopify.map((n) => n.toLowerCase()));
        const chosenName = randomName(Array.from(lower));

        // ── 3. Generate content for EACH selected store ──
        setStage("generating");
        const keywords = data.parsedKeywords;
        const contentByStore: Record<StoreKey, StoreContent> = {
          ...data.contentByStore,
        };

        const defaultPriceByStore: Record<StoreKey, string> = {
          dk: "349,00 DKK",
          fr: "49,00 EUR",
        };

        for (const store of selectedStores) {
          setSubStage(`${STORE_CONFIG[store].language} — ${STORE_CONFIG[store].label}`);
          const gen = await api.generate({
            store,
            product_name: chosenName,
            product_title: product?.title ?? "",
            keywords,
          });
          if (gen.error) throw new Error(`${store.toUpperCase()}: ${gen.error}`);

          // Build localised colour labels for this store
          const colorLabels: Record<string, string> = {};
          canonicalColors.forEach((canonical) => {
            colorLabels[canonical] = translateColor(canonical, store);
          });
          const cutline = canonicalColors
            .map((c) => colorLabels[c])
            .join(", ");

          // Preserve any existing price the user may have already set for this store;
          // otherwise default to the currency-appropriate value.
          const existingPrice = data.contentByStore[store]?.price;
          contentByStore[store] = {
            description: gen.description ?? "",
            metaDescription: gen.meta_description ?? "",
            mTitleSpecs: gen.m_title_specs ?? "",
            cutline,
            price: existingPrice || defaultPriceByStore[store],
            colorLabels,
          };
        }

        // ── 4. Done — patch everything ──
        setStage("done");
        setSubStage("");
        const primaryContent = contentByStore[primary];
        const primaryColors = canonicalColors.map(
          (c) => primaryContent.colorLabels[c] ?? c
        );

        // Make global useStore.store track the primary store so name validation etc. work
        setStore(primary);

        patch({
          competitor,
          name: chosenName,
          canonicalColors,
          colors: primaryColors,
          siblingsHandle: autoSiblingsHandle(chosenName),
          productType,
          competitorImages: images,
          competitorVariantsByColor: variantsByColor,
          competitorImagesByColor: imagesByColor,
          contentByStore,
          activeViewStore: primary,
          // Active-view mirrors
          description: primaryContent.description,
          metaDescription: primaryContent.metaDescription,
          mTitleSpecs: primaryContent.mTitleSpecs,
          cutline: primaryContent.cutline,
          price: primaryContent.price,
        });

        // brief pause so user sees "Preparing review…"
        setTimeout(() => setStep(3), 500);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        started.current = false; // allow retry
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentLabel = STAGE_LABELS[stage];

  if (error) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-bg-elev border border-danger/40 rounded-2xl px-8 py-10 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-danger/20 text-danger text-2xl flex items-center justify-center">!</div>
          <h2 className="text-[15px] font-semibold text-text">Could not generate product</h2>
          <p className="text-[13px] text-text-dim">{error}</p>
          <div className="flex gap-2 mt-2">
            <Button variant="secondary" size="sm" onClick={() => setStep(1)}>
              ← Back to Input
            </Button>
            <Button variant="primary" size="sm" onClick={() => location.reload()}>
              ↻ Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="bg-bg-elev border border-border rounded-2xl px-8 py-16 flex flex-col items-center gap-6 text-center shadow-md">
        <Spinner size={48} />
        <div className="flex flex-col gap-2 min-h-[58px]">
          <p className="text-sm font-medium text-text">{currentLabel.main}</p>
          <p className="text-xs text-text-faint">
            {stage === "generating" && subStage ? subStage : currentLabel.sub}
          </p>
        </div>
        <div className="w-full max-w-xs mt-2">
          <div className="h-1 rounded-full bg-bg-elev-2 overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-700 ease-out"
              style={{ width: `${currentLabel.pct}%` }}
            />
          </div>
        </div>
        {data.selectedStores.length > 1 && (
          <div className="text-[11px] text-text-faint">
            Generating {data.selectedStores.length} languages:{" "}
            {data.selectedStores.map((s) => STORE_CONFIG[s].label).join(" · ")}
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
          ✕ Cancel
        </Button>
      </div>
    </div>
  );
}
