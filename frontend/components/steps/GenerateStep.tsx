"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { useStep } from "@/lib/step";
import { useProduct } from "@/lib/product";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { extractColors, guessProductType, normalizeImageUrl, safeHostname } from "@/lib/scrape-utils";
import { translateColor } from "@/lib/colors";
import { randomName } from "@/lib/names";
import { autoSiblingsHandle } from "@/lib/slug";

type Stage = "scraping" | "names" | "generating" | "done";

const STAGE_LABELS: Record<Stage, { main: string; sub: string; pct: number }> = {
  scraping:   { main: "Fetching competitor product…",       sub: "Scraping product details",                          pct: 25 },
  names:      { main: "Generating product name…",           sub: "Checking uniqueness against Shopify catalogue",     pct: 50 },
  generating: { main: "Generating description via Claude…", sub: "Style: calm, practical, comfort-oriented",          pct: 80 },
  done:       { main: "Preparing review…",                  sub: "Almost there",                                      pct: 100 },
};

export function GenerateStep() {
  const { setStep } = useStep();
  const { data, patch } = useProduct();
  const { store } = useStore();
  const [stage, setStage] = useState<Stage>("scraping");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        // ── 1. Scrape competitor product ──
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
        const colors = rawColors.map((c) => translateColor(c, store));

        const images = (product?.images ?? [])
          .slice(0, 8)
          .map((img) => ({ url: normalizeImageUrl(img.src), selected: false }));
        // Pre-select first 2
        if (images[0]) images[0].selected = true;
        if (images[1]) images[1].selected = true;

        // ── 2. Pick unique product name ──
        setStage("names");
        let usedFromShopify: string[] = [];
        try {
          const r = await api.names(store);
          usedFromShopify = r.names ?? [];
        } catch {
          // Non-fatal: continue with empty list
        }
        const lower = new Set(usedFromShopify.map((n) => n.toLowerCase()));
        const chosenName = randomName(Array.from(lower));

        // ── 3. Generate content with Claude ──
        setStage("generating");
        const keywords = data.parsedKeywords;
        const gen = await api.generate({
          store,
          product_name: chosenName,
          product_title: product?.title ?? "",
          keywords,
        });
        if (gen.error) throw new Error(gen.error);

        // ── 4. Done — patch everything ──
        setStage("done");
        const primaryColor = colors[0] ?? "";
        patch({
          competitor,
          name: chosenName,
          colors,
          cutline: colors.join(", "),
          siblingsHandle: autoSiblingsHandle(chosenName),
          productType,
          competitorImages: images,
          description: gen.description ?? "",
          metaDescription: gen.meta_description ?? "",
          mTitleSpecs: gen.m_title_specs ?? "",
          // primary color cutline stays as-is, ColorVariantsCard shows each
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
          <p className="text-xs text-text-faint">{currentLabel.sub}</p>
        </div>
        <div className="w-full max-w-xs mt-2">
          <div className="h-1 rounded-full bg-bg-elev-2 overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-700 ease-out"
              style={{ width: `${currentLabel.pct}%` }}
            />
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
          ✕ Cancel
        </Button>
      </div>
    </div>
  );
}
