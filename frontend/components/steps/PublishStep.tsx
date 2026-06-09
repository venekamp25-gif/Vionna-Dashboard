"use client";

import { AnimatedCheckmark } from "@/components/ui/AnimatedCheckmark";
import { Button } from "@/components/ui/Button";
import { useProduct, colorLabelFor, pickRandomBgReferenceUrl, ProductVerify } from "@/lib/product";
import { useStore, StoreKey, STORE_CONFIG } from "@/lib/store";
import { useStep } from "@/lib/step";

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

const FLAGS: Record<StoreKey, React.ReactNode> = { dk: <FlagDK />, fr: <FlagFR />, fi: <FlagFI /> };

export function PublishStep() {
  const { data, setData, clearDraft } = useProduct();
  const { setStore } = useStore();
  const { setStep } = useStep();

  const resultsByStore = data.publishResultsByStore ?? {};
  const publishedStores = (Object.keys(resultsByStore) as StoreKey[]).filter(
    (s) => !!resultsByStore[s]
  );

  // Fallback: if for some reason resultsByStore is empty, use legacy publishResult
  // tied to the activeViewStore (single-store flow).
  const fallbackList: StoreKey[] =
    publishedStores.length > 0 ? publishedStores : [data.activeViewStore];

  const resetForNewProduct = () => {
    setData((prev) => ({
      ...prev,
      competitorUrl: "",
      keywords: "",
      competitor: null,
      name: "",
      canonicalColors: [],
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
      colorRefsByColor: {},
      pinnedUrl: null,
      publishPool: [],
      publishResult: null,
      publishResultsByStore: {},
      price: "349,00 DKK",
      contentByStore: {
        dk: { description: "", metaDescription: "", mTitleSpecs: "", cutline: "", price: "349,00 DKK", colorLabels: {} },
        fr: { description: "", metaDescription: "", mTitleSpecs: "", cutline: "", price: "49,00 EUR", colorLabels: {} },
        fi: { description: "", metaDescription: "", mTitleSpecs: "", cutline: "", price: "49,00 EUR", colorLabels: {} },
      },
      // Re-roll the background reference so each new product gets a different
      // model setup — keeps the catalogue from all looking the same.
      bgReferenceUrl: pickRandomBgReferenceUrl(),
      // keep selectedStores so the user doesn't have to re-pick if they want to do another multi-store import
    }));
    clearDraft();
    setStep(1);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {fallbackList.map((store) => {
        const result =
          resultsByStore[store] ??
          (store === data.activeViewStore ? data.publishResult : null);
        if (!result) return null;

        const productUrls = result.productUrls ?? [];
        const collectionUrl = result.collectionUrl ?? null;
        const firstProductUrl = productUrls[0];

        return (
          <StoreResultCard
            key={store}
            store={store}
            name={data.name}
            siblingsHandle={data.siblingsHandle}
            canonicalColors={data.canonicalColors}
            productUrls={productUrls}
            collectionUrl={collectionUrl}
            firstProductUrl={firstProductUrl}
            productsCreated={result.productsCreated}
            metafieldErrors={result.metafieldErrors}
            verification={result.verification}
            getColorLabel={(canonical) => colorLabelFor(data, canonical, store)}
            onJump={() => setStore(store)}
          />
        );
      })}

      <div className="flex items-center justify-between bg-bg-elev border border-border rounded-2xl px-6 py-4">
        <span className="text-[13px] text-text-dim">Ready for the next one?</span>
        <Button variant="primary" onClick={resetForNewProduct}>
          ← Create another product
        </Button>
      </div>
    </div>
  );
}

interface CardProps {
  store: StoreKey;
  name: string;
  siblingsHandle: string;
  canonicalColors: string[];
  productUrls: string[];
  collectionUrl: string | null;
  firstProductUrl?: string;
  productsCreated: number;
  metafieldErrors: string[];
  verification?: ProductVerify[];
  getColorLabel: (canonical: string) => string;
  onJump: () => void;
}

function StoreResultCard({
  store,
  name,
  siblingsHandle,
  canonicalColors,
  productUrls,
  collectionUrl,
  firstProductUrl,
  productsCreated,
  metafieldErrors,
  verification,
  getColorLabel,
  onJump,
}: CardProps) {
  const verifyIssues = (verification ?? []).filter((p) => p.issues.length > 0);
  const verifyFails = (verification ?? []).some((p) =>
    p.issues.some((i) => i.level === "fail")
  );
  return (
    <div className="bg-bg-elev border border-accent/30 rounded-2xl p-8 shadow-lg">
      <div className="flex items-start gap-4 mb-6">
        <AnimatedCheckmark size={56} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-[18px] font-bold text-text">
              <strong>{name}</strong> created in{" "}
              <strong>{STORE_CONFIG[store].label}</strong>
            </h2>
            <span className="inline-flex items-center" onClick={onJump}>
              {FLAGS[store]}
            </span>
          </div>
          <p className="text-[13px] text-text-dim leading-relaxed">
            {productsCreated ?? canonicalColors.length} color{" "}
            {(productsCreated ?? canonicalColors.length) === 1 ? "duplicate" : "duplicates"} created · collection{" "}
            {collectionUrl ? (
              <a
                href={collectionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent font-semibold border-b border-accent hover:text-accent-hover"
              >
                {siblingsHandle}
              </a>
            ) : (
              <strong className="text-text">{siblingsHandle}</strong>
            )}{" "}
            created · swatches linked. Product is set to <strong>draft</strong> until final review.
          </p>
        </div>
      </div>

      {canonicalColors.length > 0 && productUrls.length > 0 && (
        <div className="mb-6 pl-[72px]">
          <div className="text-[11px] uppercase tracking-wider text-text-faint mb-2">Variants</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {canonicalColors.map((canonical, i) => {
              const label = getColorLabel(canonical);
              return productUrls[i] ? (
                <a
                  key={canonical}
                  href={productUrls[i]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-accent font-semibold border-b border-accent/60 hover:text-accent-hover hover:border-accent-hover transition-colors"
                >
                  {label}
                </a>
              ) : (
                <span key={canonical} className="text-[13px] text-text-dim">{label}</span>
              );
            })}
          </div>
        </div>
      )}

      {firstProductUrl && (
        <div className="pl-[72px]">
          <a
            href={firstProductUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-accent text-on-accent px-5 py-2.5 rounded-[10px] font-semibold text-[13px] hover:bg-accent-hover transition-colors shadow-[0_4px_14px_var(--accent-glow)]"
          >
            → View imported product in {STORE_CONFIG[store].label}
          </a>
        </div>
      )}

      {metafieldErrors && metafieldErrors.length > 0 && (
        <div className="mt-6 pl-[72px]">
          <div className="px-3 py-2.5 rounded-md bg-warning/15 border border-warning/40 text-[12px] text-warning">
            <strong>⚠ Some metafields failed:</strong>
            <ul className="list-disc list-inside mt-1 space-y-0.5 ml-2">
              {metafieldErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {verification && verification.length > 0 && (
        <div className="mt-6 pl-[72px]">
          <div className="text-[11px] uppercase tracking-wider text-text-faint mb-2">
            Post-publish check
          </div>
          {verifyIssues.length === 0 ? (
            <div className="px-3 py-2.5 rounded-md bg-accent/10 border border-accent/30 text-[12px] text-accent">
              ✓ All {verification.length} {verification.length === 1 ? "product" : "products"} verified —
              images, colour swatch, sales channels &amp; variants all present.
            </div>
          ) : (
            <div
              className={[
                "px-3 py-2.5 rounded-md border text-[12px]",
                verifyFails
                  ? "bg-danger/10 border-danger/40 text-danger"
                  : "bg-warning/15 border-warning/40 text-warning",
              ].join(" ")}
            >
              <strong>
                {verifyIssues.length} {verifyIssues.length === 1 ? "product" : "products"} to double-check:
              </strong>
              <ul className="list-disc list-inside mt-1 space-y-0.5 ml-2">
                {verifyIssues.map((p) => (
                  <li key={p.id}>
                    <span className="text-text font-medium">{p.title}</span> —{" "}
                    {p.issues.map((iss) => iss.msg).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
