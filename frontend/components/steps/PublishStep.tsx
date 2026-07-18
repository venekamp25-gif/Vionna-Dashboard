"use client";

import { useState, useEffect, useRef } from "react";
import { AnimatedCheckmark } from "@/components/ui/AnimatedCheckmark";
import { Button } from "@/components/ui/Button";
import { api, MetaDraftResult } from "@/lib/api";
import { useProduct, colorLabelFor, pickRandomBgReferenceUrl, ProductVerify, PublishResult, saveLastProduct } from "@/lib/product";
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
  const [metaResults, setMetaResults] = useState<MetaDraftResult[] | null>(null);

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
  // Per-store localised colour labels aligned with colorKeys — the ad link is built from the
  // real Shopify handle (which uses the localised label, e.g. Finnish "musta"), so the Meta
  // job needs these to reconstruct the correct URL when the admin-id lookup can't be used.
  const colorLabelsByStore: Partial<Record<StoreKey, string[]>> = {};
  for (const store of metaStores) {
    colorLabelsByStore[store] = colorKeys.map((ck) => colorLabelFor(data, ck, store));
  }

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
            productIds={result.productIds}
            activateRequested={result.activateRequested}
            liveCount={result.liveCount}
            onVerificationUpdate={(v) =>
              setData((prev) => ({
                ...prev,
                publishResultsByStore: {
                  ...prev.publishResultsByStore,
                  [store]: { ...result, verification: v },
                },
              }))
            }
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
        colorLabelsByStore={colorLabelsByStore}
        defaultEnabled={!!data.prepareMeta}
        onAutoStarted={() => setData((p) => ({ ...p, prepareMeta: false }))}
        onComplete={setMetaResults}
      />

      <PostPublishChecklist
        stores={fallbackList.filter((s) => !!(resultsByStore[s] ?? (s === data.activeViewStore ? data.publishResult : null)))}
        resultsByStore={resultsByStore}
        legacyResult={data.publishResult ?? null}
        activeViewStore={data.activeViewStore}
        metaResults={metaResults}
      />

      <div className="bg-bg-elev border border-border rounded-2xl px-6 py-4 space-y-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[13px] text-text-dim">Done — what now?</span>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={keepForLater} disabled={kept}>
              {kept ? "✓ Saved" : "↩ Save to come back to"}
            </Button>
            <Button variant="primary" onClick={resetForNewProduct}>
              ← Create another product
            </Button>
          </div>
        </div>
        {kept && (
          <p className="text-[11px] text-text-faint leading-relaxed">
            ✓ Saved! You can now safely <strong>refresh</strong> (Ctrl+Shift+R) — after that, bring this
            product back via <strong>&ldquo;↩ Back to product&rdquo;</strong> on the start screen, to quickly
            (re)build campaigns without importing again.
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
  colorLabelsByStore,
  defaultEnabled = false,
  onAutoStarted,
  onComplete,
}: {
  stores: StoreKey[];
  colorKeys: string[];
  imagesByColor: Record<string, string[]>;
  urlByStoreColor: Partial<Record<StoreKey, string[]>>;
  productName: string;
  productType: string;
  colorLabelsByStore: Partial<Record<StoreKey, string[]>>;
  defaultEnabled?: boolean;
  onAutoStarted?: () => void;
  onComplete?: (results: MetaDraftResult[]) => void;
}) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(stores.map((s) => [s, true]))
  );
  const [phase, setPhase] = useState<string | null>(null);
  const [results, setResults] = useState<MetaDraftResult[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [canResume, setCanResume] = useState(false);
  const autoRan = useRef(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  const running = phase !== null;
  const chosen = stores.filter((s) => selected[s]);

  // Poll a running backend job to completion. The job lives server-side under jobId, so if the
  // browser poll window lapses (slow box, closed tab, flaky wifi) the job keeps going — re-polling
  // the same id later picks up wherever it got to. On timeout we don't error out: we flag the job
  // as resumable so the operator can reconnect instead of restarting (which would double-create).
  const pollJob = async (jobId: string) => {
    setCanResume(false);
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
        const res = job.result ?? [];
        setResults(res);
        if (job.summary) setNote(job.summary);
        setLastJobId(null);
        onComplete?.(res);
        return;
      }
      if (job.status === "error") {
        setErr(job.error || job.summary || (job.errors && job.errors[0]) || "The job failed.");
        return;
      }
    }
    // Browser stopped watching, but the backend job may still be finishing. Keep the id so
    // "Hervat" can re-attach rather than kicking off a duplicate run.
    setErr("Timed out — the job may still be running. Click Hervat to keep watching, or check Ads Manager.");
    setCanResume(true);
  };

  const run = async () => {
    if (chosen.length === 0) return;
    setResults(null);
    setErr(null);
    setNote(null);
    setCanResume(false);
    setLastJobId(null);
    try {
      // Hand the whole job to the backend: it generates lifestyle shots, writes copy, uploads
      // images and creates the Flexible ads — all paced server-side. We just poll for progress,
      // so the browser is never blocked and a many-colour product can't overload the box.
      setPhase("Starting…");
      const url_by_store_color: Record<string, string[]> = {};
      const color_labels_by_store: Record<string, string[]> = {};
      for (const s of chosen) {
        url_by_store_color[s] = urlByStoreColor[s] ?? [];
        color_labels_by_store[s] = colorLabelsByStore[s] ?? [];
      }

      const start = await api.metaCreateDraftJob({
        product_name: productName || "Product",
        product_type: productType || "dress",
        stores: chosen as string[],
        color_keys: colorKeys,
        images_by_color: imagesByColor,
        url_by_store_color,
        color_labels_by_store,
      });
      if (start.error || !start.job_id) {
        setErr(start.error || "Could not start the job.");
        return;
      }

      setLastJobId(start.job_id);
      await pollJob(start.job_id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase(null);
    }
  };

  // Re-attach to the last job after a poll timeout — the backend job kept running past the window,
  // so we resume watching the same jobId instead of starting over (no duplicate campaigns).
  const resume = async () => {
    if (!lastJobId) return;
    setErr(null);
    try {
      setPhase("Reconnecting…");
      await pollJob(lastJobId);
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
            <div className="flex items-center gap-2">
              {canResume && lastJobId && !running && (
                <Button variant="primary" size="sm" onClick={() => void resume()}>
                  ↻ Hervat
                </Button>
              )}
              <Button
                variant={canResume || err ? "secondary" : "primary"}
                size="sm"
                onClick={() => void run()}
                disabled={running || chosen.length === 0}
              >
                {running ? "Working…" : canResume || err ? "Opnieuw starten" : "Create paused drafts"}
              </Button>
            </div>
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
                        ✓ {r.ad_ids?.length ?? 0} ad{(r.ad_ids?.length ?? 0) === 1 ? "" : "s"} klaar (campagne op pauze)
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
  productIds?: number[];
  activateRequested?: boolean;
  liveCount?: number;
  onVerificationUpdate?: (verification: ProductVerify[]) => void;
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
  productIds,
  activateRequested,
  liveCount,
  onVerificationUpdate,
  getColorLabel,
  onJump,
}: CardProps) {
  const verifyIssues = (verification ?? []).filter((p) => (p.issues ?? []).length > 0);
  const verifyFails = (verification ?? []).some((p) =>
    (p.issues ?? []).some((i) => i.level === "fail")
  );

  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const [showBug, setShowBug] = useState(false);
  const [bugState, setBugState] = useState<"idle" | "sending" | "sent">("idle");

  // Re-attempt the auto-fixable issues (re-publish to channels) then re-verify; whatever still
  // fails gets a "report as bug" option.
  const retryFix = async () => {
    if (!productIds || productIds.length === 0) {
      setRetryMsg("Geen product-ids beschikbaar om te retryen.");
      setShowBug(true);
      return;
    }
    setRetrying(true);
    setRetryMsg(null);
    setShowBug(false);
    setBugState("idle");
    try {
      await api.retryFix(store, productIds);
      const v = await api.verifyProducts(store, productIds);
      onVerificationUpdate?.(v.products as ProductVerify[]);
      const stillBroken = (v.products ?? []).some((p) => (p.issues ?? []).length > 0);
      setRetryMsg(stillBroken ? "Een paar punten blijven openstaan." : "✓ Opgelost!");
      setShowBug(stillBroken);
    } catch (e) {
      setRetryMsg("Retry failed: " + (e instanceof Error ? e.message : String(e)));
      setShowBug(true);
    } finally {
      setRetrying(false);
    }
  };

  const reportBug = async () => {
    setBugState("sending");
    try {
      const issuesText = verifyIssues
        .map((p) => `${p.title}: ${(p.issues ?? []).map((i) => i.msg).join(", ")}`)
        .join("\n");
      await api.reportBug({
        title: `Post-publish check keeps failing after retry — ${name} (${store.toUpperCase()})`,
        description:
          `After "Retry fix" these post-publish issues remained open:\n\n${issuesText}\n\n` +
          `Product: ${name} · Store: ${store.toUpperCase()} · ${productIds?.length ?? 0} products.`,
        store,
      });
      setBugState("sent");
    } catch {
      setBugState("idle");
    }
  };

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
            created · swatches linked.{" "}
            {(() => {
              const total = productsCreated ?? canonicalColors.length;
              const live = liveCount ?? 0;
              if (!activateRequested) {
                return (
                  <>Product is set to <strong>draft</strong> until final review.</>
                );
              }
              if (live >= total && total > 0) {
                return (
                  <span className="text-accent font-semibold">
                    🟢 Product staat LIVE (actief) — zichtbaar &amp; bestelbaar.
                  </span>
                );
              }
              return (
                <span className="text-warning font-semibold">
                  ⚠ Live zetten deels mislukt — {live}/{total} live, de rest staat nog op
                  concept. Controleer handmatig.
                </span>
              );
            })()}
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
              <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => void retryFix()}
                  disabled={retrying}
                  className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md border border-current/40 hover:bg-current/10 disabled:opacity-50"
                >
                  {retrying ? "↻ Bezig…" : "↻ Retry fix"}
                </button>
                {retryMsg && <span className="text-[11px] font-medium">{retryMsg}</span>}
              </div>
              {showBug && (
                <div className="mt-1.5 text-[11px]">
                  {bugState === "sent" ? (
                    <span className="text-accent">✓ Als bug gemeld — Claude pakt 'm op bij de volgende sessie.</span>
                  ) : (
                    <>
                      Lukt het niet automatisch?{" "}
                      <button
                        type="button"
                        onClick={() => void reportBug()}
                        disabled={bugState === "sending"}
                        className="underline font-semibold disabled:opacity-50"
                      >
                        {bugState === "sending" ? "Bezig met melden…" : "Meld dit als bug →"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Post-publish "is alles goed geland?" checklist. Two parts: (1) an AUTO-STATUS block that
 *  reads the real publish + Meta results and flags only what needs attention (so an all-green
 *  run needs no manual scrutiny), and (2) a short manual tick-list for the human-eye checks
 *  the tooling can't make (photos render, copy reads well, campaign set live). Interactive
 *  ticks are ephemeral (local state) — this is a working checklist, not persisted data. */
function PostPublishChecklist({
  stores,
  resultsByStore,
  legacyResult,
  activeViewStore,
  metaResults,
}: {
  stores: StoreKey[];
  resultsByStore: Partial<Record<StoreKey, PublishResult>>;
  legacyResult: PublishResult | null;
  activeViewStore: StoreKey;
  metaResults: MetaDraftResult[] | null;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  if (stores.length === 0) return null;

  const resultFor = (s: StoreKey) =>
    resultsByStore[s] ?? (s === activeViewStore ? legacyResult : null);
  const metaFor = (s: StoreKey) => (metaResults ?? []).find((m) => m.store === s) ?? null;
  const metaRan = !!metaResults && metaResults.length > 0;
  // Was live-publish (and thus a campaign) opted into for any store? If so and the Meta
  // job hasn't reported back yet, the run isn't finished — don't declare "all good".
  const anyActivateRequested = stores.some((s) => resultFor(s)?.activateRequested);
  const metaPending = anyActivateRequested && !metaRan;

  type Level = "ok" | "warn" | "fail";
  type Row = { level: Level; label: string };
  const statusByStore = stores.map((s) => {
    const r = resultFor(s);
    const rows: Row[] = [];
    const total = r?.productsCreated ?? r?.productUrls?.length ?? 0;

    // Live vs draft — the whole point of the new one-click flow.
    if (r?.activateRequested) {
      const live = r?.liveCount ?? 0;
      rows.push(
        live >= total && total > 0
          ? { level: "ok", label: `Product is live (active) — ${total}/${total} colours` }
          : { level: "fail", label: `Going live (partly) failed — ${live}/${total} live; the rest is still a draft` }
      );
    } else {
      // Not opting into live-publish is a deliberate, correct outcome — never a warning.
      rows.push({ level: "ok", label: "Product left as a draft on purpose (not set live)" });
    }

    // Images + metafields (colour swatch / size chart / siblings).
    const mfErr = r?.metafieldErrors ?? [];
    rows.push(
      mfErr.length === 0
        ? { level: "ok", label: "Photos + metafields (colour, size chart, siblings) written" }
        : { level: "warn", label: `${mfErr.length} metafield warning(s) — see the card above` }
    );

    // Post-publish verification (already run at publish time).
    const ver = r?.verification ?? [];
    if (ver.length > 0) {
      const issues = ver.filter((p) => (p.issues ?? []).length > 0);
      const fails = ver.some((p) => (p.issues ?? []).some((i) => i.level === "fail"));
      rows.push(
        issues.length === 0
          ? { level: "ok", label: "Post-check: photos, swatch, channels & variants all present" }
          : { level: fails ? "fail" : "warn", label: `Post-check: ${issues.length} product(s) to look at` }
      );
    }

    // Meta ad drafts — only for stores that were ACTUALLY part of the ad run (present in
    // metaResults). A store the user excluded from ads gets no row (not a false warning).
    const m = metaFor(s);
    if (m) {
      rows.push(
        m.error
          ? { level: "fail", label: `Meta ads: failed — ${m.error}` }
          : { level: "ok", label: `Meta ads: ${m.ad_ids?.length ?? 0} ad(s) ready — campaign is paused (ad sets & ads are on)` }
      );
    }

    return { store: s, rows };
  });

  // "All good" = every status row ok AND no campaign still pending.
  const allOk = !metaPending && statusByStore.every((s) => s.rows.every((r) => r.level === "ok"));
  const ICON: Record<Level, string> = { ok: "✓", warn: "⚠", fail: "✕" };
  const COLOR: Record<Level, string> = { ok: "text-accent", warn: "text-warning", fail: "text-danger" };

  const manualItems: { id: string; label: string }[] = [
    { id: "page", label: "Checked the product page: photos, colour swatches and size-chart popup look right" },
    { id: "price", label: "Price + compare-at price are right in every store" },
    ...(metaRan
      ? [
          { id: "adcopy", label: "Ad preview (image + text) reads well in each language" },
          { id: "budget", label: "Budget €30/day + target country are right in Ads Manager" },
          { id: "setlive", label: "Campaign switched to LIVE in Ads Manager — one toggle (ad sets & ads are already on)" },
        ]
      : []),
  ];
  const doneCount = manualItems.filter((i) => checked[i.id]).length;

  return (
    <div className="bg-bg-elev border border-border rounded-2xl px-6 py-4 space-y-4">
      <div>
        <div className="text-[14px] font-semibold text-text">✅ Controle-checklist</div>
        <p className="text-[11px] text-text-faint mt-0.5 leading-relaxed">
          Snelle eindcheck. Groen = niks aan de hand; een ⚠ of ✕ hieronder is het enige wat je nog
          hoeft na te lopen.
        </p>
      </div>

      <div className="space-y-2.5">
        {metaPending ? (
          <div className="px-3 py-2 rounded-md bg-bg-elev-2 border border-border text-[12px] text-text-dim font-medium">
            ⏳ Meta-ads zijn nog niet afgerond — zie het kader hierboven. De checklist vult zich
            aan zodra ze klaar zijn.
          </div>
        ) : allOk ? (
          <div className="px-3 py-2 rounded-md bg-accent/10 border border-accent/30 text-[12px] text-accent font-medium">
            🎉 Alles ziet er goed uit — geen actie nodig. Loop hieronder alleen nog even de
            handmatige punten na.
          </div>
        ) : (
          <div className="px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-[12px] text-warning font-medium">
            Een paar punten vragen aandacht (⚠ / ✕). De rest ging automatisch goed.
          </div>
        )}
        {statusByStore.map(({ store, rows }) => (
          <div key={store} className="text-[12px]">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="inline-flex items-center">{FLAGS[store]}</span>
              <span className="font-semibold uppercase tracking-wider">{store}</span>
            </div>
            <ul className="space-y-0.5 ml-1">
              {rows.map((r, i) => (
                <li key={i} className={`flex items-start gap-1.5 ${COLOR[r.level]}`}>
                  <span className="mt-px">{ICON[r.level]}</span>
                  <span className={r.level === "ok" ? "text-text-dim" : ""}>{r.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[12px] font-semibold text-text">Zelf even nalopen</span>
          <span className="text-[11px] text-text-faint">
            {doneCount}/{manualItems.length} afgevinkt
          </span>
        </div>
        <div className="space-y-1.5">
          {manualItems.map((item) => (
            <label
              key={item.id}
              className="flex items-start gap-2 cursor-pointer select-none text-[12px] text-text-dim hover:text-text"
            >
              <input
                type="checkbox"
                checked={!!checked[item.id]}
                onChange={(e) => setChecked((p) => ({ ...p, [item.id]: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)] cursor-pointer"
              />
              <span className={checked[item.id] ? "line-through text-text-faint" : ""}>{item.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
