"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { useStep } from "@/lib/step";
import { useProduct, StoreContent } from "@/lib/product";
import { useStore, StoreKey, STORE_CONFIG } from "@/lib/store";
import { api, ScrapedProduct } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { ManualPasteModal } from "./ManualPasteModal";
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
import { loadToneReferences } from "@/lib/toneReference";

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
  const { data, patch, flushDraft } = useProduct();
  const { setStore } = useStore();
  const [stage, setStage] = useState<Stage>("scraping");
  const [subStage, setSubStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [manualPasteOpen, setManualPasteOpen] = useState(false);
  const started = useRef(false);

  /**
   * Process a scraped (or manually-pasted) product through Generate. Extracted
   * so the manual-paste fallback can call into the same flow as the automatic
   * scrape — once the product is in hand the rest of Generate is identical.
   */
  const processProduct = async (product: NonNullable<ScrapedProduct["product"]>) => {
    setError(null);
    setStage("scraping");
    try {
      const selectedStores = data.selectedStores.length
        ? data.selectedStores
        : (["dk"] as StoreKey[]);
      const primary = selectedStores[0];

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

        // ── 2. Pick unique product name (checked against ALL selected stores) ──
        // Multi-store products must have a name that's free in EVERY catalogue we'll
        // publish to — otherwise the user has to rename after the fact.
        setStage("names");
        const usedFromShopify = new Set<string>();
        await Promise.all(
          selectedStores.map(async (s) => {
            try {
              const r = await api.names(s);
              (r.names ?? []).forEach((n) => usedFromShopify.add(n.toLowerCase()));
            } catch {
              // non-fatal for that one store
            }
          })
        );
        const chosenName = randomName(Array.from(usedFromShopify));

        // ── 3. Generate content for EACH selected store ──
        setStage("generating");
        const contentByStore: Record<StoreKey, StoreContent> = {
          ...data.contentByStore,
        };

        const defaultPriceByStore: Record<StoreKey, string> = {
          dk: "349,00 DKK",
          fr: "49,00 EUR",
        };

        const toneRefs = loadToneReferences();
        for (const store of selectedStores) {
          setSubStage(`${STORE_CONFIG[store].language} — ${STORE_CONFIG[store].label}`);
          // Each store ships its OWN keyword list (parsed at Input). The Danish
          // copy should never be seeded by French SEO research and vice versa.
          // Falls back to the legacy flat list for drafts that pre-date the split.
          const perStore = data.parsedKeywordsByStore?.[store] ?? [];
          const storeKeywords = perStore.length > 0 ? perStore : data.parsedKeywords;
          const gen = await api.generate({
            store,
            product_name: chosenName,
            product_title: product?.title ?? "",
            keywords: storeKeywords,
            tone_references: toneRefs[store],
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
        notify(
          `${chosenName} ready for review`,
          `Scraped + ${selectedStores.length === 1 ? "1 language" : `${selectedStores.length} languages`} generated.`,
          "generate-done"
        );
        // Force-flush so a crash between Generate and Review never costs the
        // scraped data + Claude-generated copy.
        setTimeout(() => flushDraft(), 0);
        setTimeout(() => setStep(3), 500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      started.current = false; // allow retry
    }
  };

  // Initial fire: scrape the competitor URL and feed it through processProduct.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const scraped = await api.scrape(data.competitorUrl);
        if (scraped.error || !scraped.product) throw new Error(scraped.error || "Scrape failed");
        await processProduct(scraped.product);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        started.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentLabel = STAGE_LABELS[stage];

  if (error) {
    // Detect errors that are "the scraper got blocked" rather than "the
    // user did something wrong" so we can offer the manual-paste escape hatch.
    const looksLikeBlock =
      /cloudflare|anti-bot|blocking|cdn|geo-restrict|authentication|private|preventing|forbidden/i.test(error) ||
      error.startsWith("API /api/scrape");

    return (
      <>
        <div className="max-w-2xl mx-auto">
          <div className="bg-bg-elev border border-danger/40 rounded-2xl px-8 py-10 flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-danger/20 text-danger text-2xl flex items-center justify-center">!</div>
            <h2 className="text-[15px] font-semibold text-text">Could not generate product</h2>
            <p className="text-[13px] text-text-dim">{error}</p>

            {/* When the failure looks like an anti-bot block, walk the user
                through the manual-paste workaround right here on the screen
                so they don't have to read a separate manual. */}
            {looksLikeBlock && (
              <div className="w-full mt-4 text-left bg-bg-elev-2 border border-border rounded-[12px] p-5">
                <div className="text-[13px] font-semibold text-text mb-2 flex items-center gap-2">
                  💡 Workaround: paste the product JSON manually (about 30 seconds)
                </div>
                <p className="text-[12px] text-text-dim mb-3 leading-relaxed">
                  This shop is blocking our scraper, but it works fine from your
                  own browser. Open the product&apos;s JSON URL in a new tab, copy the
                  whole page, paste it back here, and the dashboard will continue
                  as if it had scraped automatically.
                </p>
                <ol className="text-[12px] text-text-dim leading-relaxed list-decimal list-inside space-y-1 mb-4">
                  <li>
                    Click <strong className="text-text">&ldquo;Paste JSON manually&rdquo;</strong> below.
                    A modal opens with the right URL pre-filled.
                  </li>
                  <li>
                    In that modal click <strong className="text-text">&ldquo;Open ↗&rdquo;</strong> — a new
                    browser tab opens with the product&apos;s JSON (a long wall of
                    text starting with <code className="bg-bg-elev px-1 rounded text-[11px]">{"{\"product\":{"}</code>).
                  </li>
                  <li>
                    In that new tab press <strong className="text-text">Ctrl + A</strong> to select
                    everything, then <strong className="text-text">Ctrl + C</strong> to copy.
                  </li>
                  <li>
                    Come back to the modal and paste (<strong className="text-text">Ctrl + V</strong>)
                    into the big text area, then click{" "}
                    <strong className="text-text">&ldquo;Use this JSON →&rdquo;</strong>.
                  </li>
                </ol>
                <div className="text-[11px] text-text-faint border-t border-border pt-3 leading-relaxed">
                  ⚠ <strong className="text-text-dim">Multi-colour heads-up:</strong> manual paste
                  captures one colour at a time. For shops where each colour is a
                  separate product page (Billy J, SKIMS, meshki), repeat this for
                  every colour OR publish each colour as its own import. Most
                  Cloudflare-blocked shops you&apos;ll hit only have one colour per
                  URL anyway.
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-2 flex-wrap justify-center">
              <Button variant="secondary" size="sm" onClick={() => setStep(1)}>
                ← Back to Input
              </Button>
              <Button variant="secondary" size="sm" onClick={() => location.reload()}>
                ↻ Try again
              </Button>
              <Button variant="primary" size="sm" onClick={() => setManualPasteOpen(true)}>
                ⌨ Paste JSON manually
              </Button>
            </div>
          </div>
        </div>
        <ManualPasteModal
          open={manualPasteOpen}
          originalUrl={data.competitorUrl}
          onClose={() => setManualPasteOpen(false)}
          onSuccess={(product) => {
            setManualPasteOpen(false);
            // Re-run the flow with the manually-pasted product
            void processProduct(product);
          }}
        />
      </>
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
