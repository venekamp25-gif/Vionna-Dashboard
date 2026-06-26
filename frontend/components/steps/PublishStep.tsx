"use client";

import { useState, useEffect, useRef } from "react";
import { AnimatedCheckmark } from "@/components/ui/AnimatedCheckmark";
import { Button } from "@/components/ui/Button";
import { api, MetaDraftResult } from "@/lib/api";
import { useProduct, colorLabelFor, pickRandomBgReferenceUrl, ProductVerify, saveLastProduct } from "@/lib/product";
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
  const [kept, setKept] = useState(false);

  const resultsByStore = data.publishResultsByStore ?? {};
  const publishedStores = (Object.keys(resultsByStore) as StoreKey[]).filter(
    (s) => !!resultsByStore[s]
  );

  // Fallback: if for some reason resultsByStore is empty, use legacy publishResult
  // tied to the activeViewStore (single-store flow).
  const fallbackList: StoreKey[] =
    publishedStores.length > 0 ? publishedStores : [data.activeViewStore];

  // For the Meta drafts (one ad per COLOUR variant): per-colour photos + per-store, per-colour
  // product URLs. canonicalColors[i] aligns with publishResult.productUrls[i].
  const step1img = data.nbResults?.[1]?.[0]?.url || "";
  const step2img = data.nbResults?.[2]?.[0]?.url || "";
  const sharedFallback = [
    step1img,
    step2img,
    ...(data.publishPool ?? []).map((p) => p.url),
    ...(data.competitorImages ?? []).map((c) => c.url),
  ].filter(Boolean);
  const colorKeys = (data.canonicalColors ?? []).length > 0 ? data.canonicalColors : ["Product"];
  const imagesByColor: Record<string, string[]> = {};
  for (const c of colorKeys) {
    const own = (data.nbResultsPerColor?.[c] ?? []).map((r) => r.url).filter(Boolean);
    imagesByColor[c] = own.length > 0 ? own : sharedFallback;
  }
  const urlByStoreColor: Partial<Record<StoreKey, string[]>> = {};
  for (const store of fallbackList) {
    const result =
      resultsByStore[store] ?? (store === data.activeViewStore ? data.publishResult : null);
    if (result?.productUrls?.length) urlByStoreColor[store] = result.productUrls;
  }
  const metaStores = fallbackList.filter((s) => (urlByStoreColor[s]?.length ?? 0) > 0);

  const resetForNewProduct = () => {
    // Stash the finished product so the user can jump back into it later (e.g. to re-test
    // Meta campaign creation) without re-importing.
    saveLastProduct(data);
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
      prepareMeta: false,
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

  // Stash this finished product so it survives a refresh — then retrieve it via the "back to
  // last product" banner on the Input step to re-test campaigns without re-importing.
  const keepForLater = () => {
    saveLastProduct(data);
    setKept(true);
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

      <MetaDraftSection
        stores={metaStores}
        colorKeys={colorKeys}
        imagesByColor={imagesByColor}
        urlByStoreColor={urlByStoreColor}
        productName={data.name}
        productType={data.productType}
        defaultEnabled={!!data.prepareMeta}
        onAutoStarted={() => setData((p) => ({ ...p, prepareMeta: false }))}
      />

      <div className="bg-bg-elev border border-border rounded-2xl px-6 py-4 space-y-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[13px] text-text-dim">Klaar — wat nu?</span>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={keepForLater} disabled={kept}>
              {kept ? "✓ Bewaard" : "↩ Bewaar om terug te komen"}
            </Button>
            <Button variant="primary" onClick={resetForNewProduct}>
              ← Create another product
            </Button>
          </div>
        </div>
        {kept && (
          <p className="text-[11px] text-text-faint leading-relaxed">
            ✓ Bewaard! Je kunt nu veilig <strong>refreshen</strong> (Ctrl+Shift+R) — daarna haal je
            dit product terug via <strong>&ldquo;↩ Terug naar product&rdquo;</strong> op het
            startscherm, om snel campagnes te (her)maken zonder opnieuw te importeren.
          </p>
        )}
      </div>
    </div>
  );
}

/** Prepare PAUSED Meta Ads draft campaigns for the published stores. Per checked store: one
 *  Flexible ad per colour variant (that colour's photos + 2 generated lifestyle shots), with
 *  per-language ad copy, in a paused Sales campaign. Nothing goes live — the operator finalises
 *  + launches in Ads Manager. */
function MetaDraftSection({
  stores,
  colorKeys,
  imagesByColor,
  urlByStoreColor,
  productName,
  productType,
  defaultEnabled = false,
  onAutoStarted,
}: {
  stores: StoreKey[];
  colorKeys: string[];
  imagesByColor: Record<string, string[]>;
  urlByStoreColor: Partial<Record<StoreKey, string[]>>;
  productName: string;
  productType: string;
  defaultEnabled?: boolean;
  onAutoStarted?: () => void;
}) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(stores.map((s) => [s, true]))
  );
  const [phase, setPhase] = useState<string | null>(null);
  const [results, setResults] = useState<MetaDraftResult[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const autoRan = useRef(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  const running = phase !== null;
  const chosen = stores.filter((s) => selected[s]);

  const run = async () => {
    if (chosen.length === 0) return;
    setResults(null);
    setErr(null);
    setNote(null);
    try {
      // Hand the whole job to the backend: it generates lifestyle shots, writes copy, uploads
      // images and creates the Flexible ads — all paced server-side. We just poll for progress,
      // so the browser is never blocked and a many-colour product can't overload the box.
      setPhase("Starting…");
      const url_by_store_color: Record<string, string[]> = {};
      for (const s of chosen) url_by_store_color[s] = urlByStoreColor[s] ?? [];

      const start = await api.metaCreateDraftJob({
        product_name: productName || "Product",
        product_type: productType || "dress",
        stores: chosen as string[],
        color_keys: colorKeys,
        images_by_color: imagesByColor,
        url_by_store_color,
      });
      if (start.error || !start.job_id) {
        setErr(start.error || "Could not start the job.");
        return;
      }

      const jobId = start.job_id;
      for (let polls = 0; polls < 600; polls++) {
        await new Promise((r) => setTimeout(r, 2500));
        let job;
        try {
          job = await api.metaJobStatus(jobId);
        } catch {
          continue; // transient network blip — keep polling
        }
        const prog = job.total ? ` (${job.processed}/${job.total})` : "";
        setPhase(`${job.phase || "Working"}${prog}…`);
        if (job.status === "done") {
          setResults(job.result ?? []);
          if (job.summary) setNote(job.summary);
          return;
        }
        if (job.status === "error") {
          setErr(job.error || job.summary || (job.errors && job.errors[0]) || "The job failed.");
          return;
        }
      }
      setErr("Timed out waiting for the job — check Ads Manager.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase(null);
    }
  };

  // If the user ticked "Prepare Meta Ads" in Review, auto-start once on mount so the drafts
  // are prepared right after publishing (with visible progress) — no extra click needed.
  // onAutoStarted clears the flag so it can't re-fire on a remount or a later revisit.
  useEffect(() => {
    if (defaultEnabled && !autoRan.current && stores.length > 0) {
      autoRan.current = true;
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      onAutoStarted?.();
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (stores.length === 0) return null;

  return (
    <div ref={sectionRef} className="bg-bg-elev border border-border rounded-2xl px-6 py-4 space-y-3">
      {/* master opt-in — OFF by default; nothing shows or runs until checked */}
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={running}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)] cursor-pointer"
        />
        <div>
          <div className="text-[14px] font-semibold text-text">📣 Prepare Meta Ads campaign</div>
          <p className="text-[11px] text-text-faint mt-0.5 leading-relaxed">
            Optional. Per checked store: a <strong>PAUSED</strong> Sales campaign (€30/day,
            Advantage+) targeted to that country, with <strong>5 image ads</strong> (2 model shots +
            3 AI lifestyle) and auto-translated ad copy. Nothing goes live — you finalise &amp;
            launch in Ads Manager.
          </p>
        </div>
      </label>

      {enabled && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="flex flex-wrap gap-2">
              {stores.map((store) => {
                const on = !!selected[store];
                return (
                  <button
                    key={store}
                    type="button"
                    onClick={() => setSelected((p) => ({ ...p, [store]: !p[store] }))}
                    disabled={running}
                    aria-pressed={on}
                    className={[
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors disabled:opacity-50",
                      on
                        ? "bg-accent/15 border-accent/50 text-accent"
                        : "bg-transparent border-border text-text-dim hover:border-accent/40",
                    ].join(" ")}
                  >
                    {FLAGS[store]}
                    <span className="uppercase tracking-wider">{store}</span>
                    {on && <span>✓</span>}
                  </button>
                );
              })}
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void run()}
              disabled={running || chosen.length === 0}
            >
              {running ? "Working…" : "Create paused drafts"}
            </Button>
          </div>

          {phase && <p className="text-[12px] text-text-dim">⏳ {phase}</p>}
          {err && <p className="text-[12px] text-danger">⚠ {err}</p>}

          {results && (
            <div className="space-y-1.5 border-t border-border pt-2.5">
              {note && <p className="text-[11px] text-text-faint">{note}</p>}
              {results.map((r) => (
                <div key={r.store} className="text-[12px] flex items-center gap-2 flex-wrap">
                  <span className="font-semibold uppercase tracking-wider">{r.store}</span>
                  {r.error ? (
                    <span className="text-danger">✕ {r.error}</span>
                  ) : (
                    <>
                      <span className="text-accent">
                        ✓ {r.ad_ids?.length ?? 0} paused ad{(r.ad_ids?.length ?? 0) === 1 ? "" : "s"} created
                      </span>
                      <a
                        href="https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=6399532626780380"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        open in Ads Manager →
                      </a>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
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
  const verifyIssues = (verification ?? []).filter((p) => (p.issues ?? []).length > 0);
  const verifyFails = (verification ?? []).some((p) =>
    (p.issues ?? []).some((i) => i.level === "fail")
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
                    {(p.issues ?? []).map((iss) => iss.msg).join(", ")}
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
