"use client";

import { AnimatedCheckmark } from "@/components/ui/AnimatedCheckmark";
import { Button } from "@/components/ui/Button";
import { useProduct } from "@/lib/product";
import { useStore, STORE_CONFIG } from "@/lib/store";
import { useStep } from "@/lib/step";

export function PublishStep() {
  const { data, setData } = useProduct();
  const { store } = useStore();
  const { setStep } = useStep();

  // Mock product links — Phase 4 will return real Shopify admin URLs
  const mockBase = store === "dk" ? "https://admin.shopify.com/store/vionna-dk" : "https://admin.shopify.com/store/vionna-fr";
  const productUrls = data.colors.map((_, i) => `${mockBase}/products/${1000 + i}`);
  const collectionUrl = `${mockBase}/collections/${data.siblingsHandle}`;
  const firstProductUrl = productUrls[0];

  const resetForNewProduct = () => {
    // Reset everything except store/theme
    setData((prev) => ({
      ...prev,
      competitorUrl: "",
      keywords: "",
      competitor: null,
      name: "",
      colors: [],
      description: "",
      metaDescription: "",
      mTitleSpecs: "",
      cutline: "",
      siblingsHandle: "",
      parsedKeywords: [],
      competitorImages: [],
      nbResults: {},
      nbResultsPerColor: {},
      publishPool: [],
    }));
    setStep(1);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-bg-elev border border-accent/30 rounded-2xl p-8 shadow-lg">
        <div className="flex items-start gap-4 mb-6">
          <AnimatedCheckmark size={56} />
          <div className="flex-1">
            <h2 className="text-[18px] font-bold text-text mb-1">
              <strong>{data.name}</strong> created in <strong>{STORE_CONFIG[store].label}</strong>
            </h2>
            <p className="text-[13px] text-text-dim leading-relaxed">
              {data.colors.length} color {data.colors.length === 1 ? "duplicate" : "duplicates"} created · collection{" "}
              <a href={collectionUrl} target="_blank" rel="noopener noreferrer" className="text-accent font-semibold border-b border-accent hover:text-accent-hover">
                {data.siblingsHandle}
              </a>{" "}
              created · swatches linked. Product is set to <strong>draft</strong> until final review.
            </p>
          </div>
        </div>

        {data.colors.length > 0 && (
          <div className="mb-6 pl-[72px]">
            <div className="text-[11px] uppercase tracking-wider text-text-faint mb-2">Variants</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {data.colors.map((color, i) => (
                <a
                  key={color}
                  href={productUrls[i]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-accent font-semibold border-b border-accent/60 hover:text-accent-hover hover:border-accent-hover transition-colors"
                >
                  {color}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="pl-[72px]">
          <a
            href={firstProductUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-accent text-on-accent px-5 py-2.5 rounded-[10px] font-semibold text-[13px] hover:bg-accent-hover transition-colors shadow-[0_4px_14px_var(--accent-glow)]"
          >
            → View imported product in Shopify
          </a>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between bg-bg-elev border border-border rounded-2xl px-6 py-4">
        <span className="text-[13px] text-text-dim">
          Ready for the next one?
        </span>
        <Button variant="primary" onClick={resetForNewProduct}>
          ← Create another product
        </Button>
      </div>

      <p className="text-[11px] text-text-faint text-center mt-3">
        Demo mode — Shopify links are placeholders. Real publish wires up in Phase 4.
      </p>
    </div>
  );
}
