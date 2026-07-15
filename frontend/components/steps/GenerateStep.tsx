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
import { KeywordReviewModal, ReviewKw } from "./KeywordReviewModal";
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

type Stage = "scraping" | "names" | "researching" | "review" | "generating" | "done";

const STAGE_LABELS: Record<Stage, { main: string; sub: string; pct: number }> = {
  scraping:    { main: "Fetching competitor product…",       sub: "Scraping product details",                          pct: 20 },
  names:       { main: "Generating product name…",           sub: "Checking uniqueness against Shopify catalogue",     pct: 40 },
  researching: { main: "Researching keywords…",              sub: "Finding high-volume keywords per market",           pct: 55 },
  review:      { main: "Waiting for keyword review…",        sub: "Confirm the keywords to continue",                  pct: 60 },
  generating:  { main: "Generating content via Claude…",     sub: "Style: calm, practical, comfort-oriented",          pct: 85 },
  done:        { main: "Preparing review…",                  sub: "Almost there",                                      pct: 100 },
};

/** Everything computed before the keyword-review gate, carried across to the
 *  generation phase once the worker confirms the keywords. */
type PendingCtx = {
  product: NonNullable<ScrapedProduct["product"]>;
  selectedStores: StoreKey[];
  primary: StoreKey;
  chosenName: string;
  canonicalColors: string[];
  productType: string;
  competitor: { title: string; hostname: string; variants: number; price: string; sourceText: string };
  images: { url: string; selected: boolean; variantIds: number[] }[];
  variantsByColor: ReturnType<typeof extractVariantsByColor>;
  imagesByColor: ReturnType<typeof groupImagesByColor>;
};

/** Plain-text competitor info (title + description). Source of truth for fabric
 *  claims: fabric keywords (cashmere, wool, silk…) are only offered/used when this
 *  text names that fabric — backend rule 2026-07-15. */
function competitorSourceText(product: ScrapedProduct["product"]): string {
  const body = (product?.body_html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [product?.title ?? "", body].join(" ").trim().slice(0, 4000);
}

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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pending, setPending] = useState<PendingCtx | null>(null);
  const [reviewByStore, setReviewByStore] = useState<Partial<Record<StoreKey, ReviewKw[]>>>({});
  const started = useRef(false);

  /**
   * PHASE 1 — scrape → name → keyword research, then STOP at the keyword-review
   * gate. Nothing is generated yet: the worker confirms the (recommended)
   * keywords in a popup first, then {@link finishGeneration} writes the copy.
   * When DataForSEO is dormant (configured:false) there's nothing to review, so
   * we skip straight to generation with the manual/legacy keywords (today's
   * behaviour). Shared by the auto-scrape and the manual-paste fallback.
   */
  const prepareProduct = async (product: NonNullable<ScrapedProduct["product"]>) => {
    setError(null);
    setReviewOpen(false);
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
        sourceText: competitorSourceText(product),
      };
      const productType = guessProductType(product);
      const canonicalColors = extractColors(product).map(canonicalize);

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

      const ctx: PendingCtx = {
        product,
        selectedStores,
        primary,
        chosenName,
        canonicalColors,
        productType,
        competitor,
        images,
        variantsByColor,
        imagesByColor,
      };

      // ── 3. Keyword research (DataForSEO) ── build the review candidates.
      setStage("researching");
      let configured = false;
      const research: Partial<Record<StoreKey, ReviewKw[]>> = {};
      try {
        const kr = await api.researchKeywords({
          stores: selectedStores,
          product_name: chosenName,
          competitor_title: product?.title ?? "",
          // Competitor's own info — fabric keywords the competitor never mentions
          // are dropped server-side before they reach the review popup.
          description: competitorSourceText(product),
        });
        if (kr.configured && kr.results) {
          configured = true;
          for (const st of selectedStores) {
            research[st] = (kr.results[st]?.keywords ?? [])
              .filter((k) => k.keyword)
              .map((k) => ({
                keyword: k.keyword,
                volume: k.volume ?? null,
                intent: k.intent ?? null,
                recommended: !!k.recommended,
                source: "research" as const,
                seasonality: k.seasonality ?? null,
              }));
          }
        }
      } catch {
        /* dormant / network error → generate with manual/legacy keywords */
      }

      if (!configured) {
        // DataForSEO off → nothing to review, keep today's behaviour.
        await finishGeneration(ctx, null);
        return;
      }

      // Merge the worker's manual keywords (pre-ticked) with the researched ones.
      const byStore: Partial<Record<StoreKey, ReviewKw[]>> = {};
      for (const st of selectedStores) {
        // ONLY this store's own typed keywords count as "manual". Never fall back
        // to the legacy flat list (data.parsedKeywords = the PRIMARY store's
        // keywords) — that would leak e.g. Danish keywords into an empty French
        // store and wrongly block its auto-research.
        const manual = data.parsedKeywordsByStore?.[st] ?? [];
        const seen = new Set<string>();
        const list: ReviewKw[] = [];
        manual.forEach((kw) => {
          const k = (kw || "").trim();
          const low = k.toLowerCase();
          if (!k || seen.has(low)) return;
          seen.add(low);
          list.push({ keyword: k, volume: null, intent: null, recommended: false, source: "manual", seasonality: null });
        });
        (research[st] ?? []).forEach((k) => {
          const low = k.keyword.toLowerCase();
          if (seen.has(low)) return;
          seen.add(low);
          list.push(k);
        });
        byStore[st] = list;
      }

      setPending(ctx);
      setReviewByStore(byStore);
      setStage("review");
      setReviewOpen(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      started.current = false; // allow retry
    }
  };

  /**
   * PHASE 2 — generate the copy for each store using the confirmed keywords, then
   * patch everything and advance to Review. `selectedByStore` is the worker's
   * approved keyword set per store (null when the review gate was skipped, e.g.
   * DataForSEO dormant → fall back to manual/legacy keywords).
   */
  const finishGeneration = async (
    ctx: PendingCtx,
    selectedByStore: Partial<Record<StoreKey, string[]>> | null
  ) => {
    const {
      product,
      selectedStores,
      primary,
      chosenName,
      canonicalColors,
      productType,
      competitor,
      images,
      variantsByColor,
      imagesByColor,
    } = ctx;
    try {
      setReviewOpen(false);
      setStage("generating");
      const contentByStore: Record<StoreKey, StoreContent> = { ...data.contentByStore };
      const defaultPriceByStore: Record<StoreKey, string> = {
        dk: "349,00 DKK",
        fr: "49,00 EUR",
        fi: "49,00 EUR",
      };
      const toneRefs = loadToneReferences();

      // Persist the approved keywords into the per-store boxes so the Review step
      // shows exactly what the copy was built from (and survives a reload).
      if (selectedByStore) {
        const kwByStore = { ...data.keywordsByStore };
        const parsedByStore = { ...data.parsedKeywordsByStore };
        for (const st of selectedStores) {
          const kws = selectedByStore[st] ?? [];
          kwByStore[st] = kws.join("\n");
          parsedByStore[st] = kws;
        }
        patch({ keywordsByStore: kwByStore, parsedKeywordsByStore: parsedByStore });
      }

      for (const store of selectedStores) {
        setSubStage(`${STORE_CONFIG[store].language} — ${STORE_CONFIG[store].label}`);
        // Approved keywords from the review popup, else THIS store's own manual
        // keywords. Never the legacy flat mirror (primary store) — that would
        // leak the primary store's keywords into other languages.
        const confirmed = selectedByStore?.[store];
        const storeKeywords = confirmed !== undefined ? confirmed : (data.parsedKeywordsByStore?.[store] ?? []);
        const gen = await api.generate({
          store,
          product_name: chosenName,
          product_title: product?.title ?? "",
          keywords: storeKeywords,
          tone_references: toneRefs[store],
          source_text: competitor.sourceText,
        });
        if (gen.error) throw new Error(`${store.toUpperCase()}: ${gen.error}`);

        // Localise the colour names into this store's language via a dedicated,
        // reliable call (robust for ANY source language). Falls back to the
        // static table → canonical if the call fails or returns a short list.
        let translated: string[] | null = null;
        if (canonicalColors.length > 0) {
          try {
            const tr = await api.translateColors({ store, colors: canonicalColors });
            if (Array.isArray(tr.colors) && tr.colors.length === canonicalColors.length) {
              translated = tr.colors;
            }
          } catch {
            /* fall back below */
          }
        }
        const colorLabels: Record<string, string> = {};
        canonicalColors.forEach((canonical, i) => {
          const t = translated?.[i]?.trim();
          colorLabels[canonical] = t || translateColor(canonical, store);
        });
        const cutline = canonicalColors.map((c) => colorLabels[c]).join(", ");

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
      const primaryColors = canonicalColors.map((c) => primaryContent.colorLabels[c] ?? c);

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

  // Initial fire: scrape the competitor URL and feed it through prepareProduct.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const scraped = await api.scrape(data.competitorUrl);
        if (scraped.error || !scraped.product) throw new Error(scraped.error || "Scrape failed");
        // Carry the competitor's size chart through to publish (appended, localised,
        // to the description). Patch it BEFORE prepareProduct so it survives the
        // keyword-review pause. null when the page had no usable table. Also carry
        // the status/hint so Review can offer "Notify" when a chart exists but was
        // unreadable (unknown app).
        patch({
          sizeChart: scraped.size_chart ?? null,
          sizeChartStatus: scraped.size_chart_status ?? null,
          sizeChartHint: scraped.size_chart_hint ?? null,
        });
        await prepareProduct(scraped.product);
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
            void prepareProduct(product);
          }}
        />
      </>
    );
  }

  const inReview = stage === "review";

  return (
    <>
      <div className="max-w-xl mx-auto">
        <div className="bg-bg-elev border border-border rounded-2xl px-8 py-16 flex flex-col items-center gap-6 text-center shadow-md">
          {inReview ? (
            <div className="w-12 h-12 rounded-full bg-[var(--accent-soft)] text-accent text-2xl flex items-center justify-center">
              🔑
            </div>
          ) : (
            <Spinner size={48} />
          )}
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
          {data.selectedStores.length > 1 && !inReview && (
            <div className="text-[11px] text-text-faint">
              Generating {data.selectedStores.length} languages:{" "}
              {data.selectedStores.map((s) => STORE_CONFIG[s].label).join(" · ")}
            </div>
          )}
          {inReview ? (
            <Button variant="secondary" size="sm" onClick={() => setReviewOpen(true)}>
              Review keywords
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              ✕ Cancel
            </Button>
          )}
        </div>
      </div>

      <KeywordReviewModal
        open={reviewOpen && !!pending}
        stores={pending?.selectedStores ?? []}
        byStore={reviewByStore}
        productName={pending?.chosenName ?? ""}
        onCancel={() => {
          setReviewOpen(false);
          started.current = false;
          setStep(1);
        }}
        onConfirm={(selectedByStore) => {
          if (pending) void finishGeneration(pending, selectedByStore);
        }}
      />
    </>
  );
}
