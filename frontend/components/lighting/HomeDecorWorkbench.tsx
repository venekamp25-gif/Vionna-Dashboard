"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "@/components/LogoutButton";
import {
  api,
  lightingApi,
  LIGHT_STORE_CONFIG,
  type LightStore,
  type LightStatusResponse,
  type LightPublishResult,
  type ScrapedProduct,
} from "@/lib/api";
import { useLightProduct, type LightContent } from "@/lib/lightProduct";
import { LightWhatToList } from "./LightWhatToList";

const STORES: LightStore[] = ["nl", "de", "com"];

/** Strip HTML → plain text. This is what a spec claim is checked against. */
function toPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Section shell — same visual language as the research workbench. */
function Section({
  step,
  title,
  hint,
  children,
  done,
}: {
  step: number;
  title: string;
  hint: string;
  children: React.ReactNode;
  done?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-border bg-bg-elev p-6 lg:p-7">
      <div className="flex items-start gap-3 mb-5">
        <span
          className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-[12px] font-bold border ${
            done
              ? "bg-accent text-on-accent border-accent"
              : "bg-bg-elev-2 text-text-dim border-border"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-text tracking-tight">{title}</h2>
          <p className="text-[12px] text-text-dim mt-0.5 leading-relaxed max-w-2xl">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function HomeDecorWorkbench() {
  const { draft, patch, patchContent, reset } = useLightProduct();
  const [status, setStatus] = useState<LightStatusResponse | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<LightStore | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<Record<string, LightPublishResult> | null>(null);
  const [researchMarket, setResearchMarket] = useState<LightStore>("nl");

  useEffect(() => {
    lightingApi.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  const configured = status?.ready ?? [];
  // `status === null` means we couldn't ASK (backend hiccup) — that's not the same
  // as "not connected". Don't block publishing on an unknown: let the attempt run
  // and surface the backend's own error, instead of a dead button with no reason.
  const knownNotConfigured = !!status && configured.length === 0;

  // ── Step 1: scrape the competitor's lamp ──────────────────────────────────
  const runScrape = async () => {
    const url = draft.competitorUrl.trim();
    if (!url) return;
    setScraping(true);
    setScrapeError(null);
    try {
      const res: ScrapedProduct = await api.scrape(url);
      if (res.error || !res.product) throw new Error(res.error || "Nothing came back");
      const p = res.product;
      const sourceText = [p.title ?? "", toPlainText(p.body_html ?? "")].join(" ").trim().slice(0, 4000);

      // The variant axis, exactly as this product has it. The live catalogue uses
      // Kleur, Color, Design and light-colour — so read it, never assume "colour".
      const opt = (p.options ?? []).find((o) => (o.values ?? []).length > 1) ?? (p.options ?? [])[0];
      const optionName = opt?.name && opt.name !== "Title" ? opt.name : "";
      const optionValues = optionName ? (opt?.values ?? []).filter(Boolean) : [];

      // Images, plus the competitor's own variant→image tagging where present.
      const imgs = (p.images ?? []).slice(0, 12).map((im) => ({
        url: im.src.startsWith("//") ? `https:${im.src}` : im.src,
        selected: true,
      }));

      // Two shapes exist in the wild and only one is usually filled. Verified on
      // the real catalogue (AMBIENTIFY Bottle): its variants carry NO
      // featured_image — the link lives on images[].variant_ids instead. Reading
      // only featured_image would silently map zero photos to variants.
      const byValue: Record<string, string[]> = {};
      const abs = (s: string) => (s.startsWith("//") ? `https:${s}` : s);
      const valueByVariantId = new Map<number, string>();
      for (const v of p.variants ?? []) {
        if (v.id && v.option1) valueByVariantId.set(v.id, v.option1);
      }
      for (const im of p.images ?? []) {
        for (const vid of im.variant_ids ?? []) {
          const val = valueByVariantId.get(vid);
          if (val) (byValue[val] ||= []).push(abs(im.src));
        }
      }
      for (const v of p.variants ?? []) {
        const val = v.option1 ?? "";
        const src = v.featured_image?.src;
        if (val && src && !(byValue[val]?.length)) (byValue[val] ||= []).push(abs(src));
      }

      const firstPrice = p.variants?.[0]?.price ?? "";
      patch({
        sourceText,
        competitorTitle: p.title ?? "",
        productName: draft.productName || (p.title ?? ""),
        optionName,
        optionValues,
        images: imgs,
        imagesByValue: byValue,
        price: draft.price || firstPrice,
        content: {},
      });
    } catch (e) {
      setScrapeError(e instanceof Error ? e.message : String(e));
    } finally {
      setScraping(false);
    }
  };

  // ── Step 2: copy per market ───────────────────────────────────────────────
  const generateFor = async (store: LightStore) => {
    if (!draft.sourceText) return;
    setGenerating(store);
    try {
      const r = await lightingApi.generate({
        store,
        product_name: draft.productName,
        product_title: draft.competitorTitle,
        source_text: draft.sourceText,
      });
      if (r.error) throw new Error(r.error);
      const c: LightContent = {
        description: r.description ?? "",
        metaDescription: r.meta_description ?? "",
        mTitleSpecs: r.m_title_specs ?? "",
        unverifiedClaims: r.unverified_claims ?? [],
        sourceSpecs: r.source_specs ?? [],
      };
      // Functional update — generateAll() awaits several markets in a row, and a
      // spread of the render-time draft.content would drop all but the last.
      patchContent(store, c);
    } catch (e) {
      alert(`Copy failed for ${LIGHT_STORE_CONFIG[store].label}: ${e instanceof Error ? e.message : e}`);
    } finally {
      setGenerating(null);
    }
  };

  const generateAll = async () => {
    for (const s of draft.selectedStores) await generateFor(s);
  };

  // ── Step 3: publish ───────────────────────────────────────────────────────
  const readyToPublish =
    !!draft.productName.trim() &&
    !!draft.price.trim() &&
    draft.selectedStores.length > 0 &&
    draft.selectedStores.every((s) => (draft.content[s]?.description ?? "").trim().length > 0);

  const runPublish = async () => {
    if (!readyToPublish || publishing) return;
    const claimed = draft.selectedStores.flatMap((s) => draft.content[s]?.unverifiedClaims ?? []);
    if (claimed.length > 0) {
      const ok = confirm(
        `The copy claims specs the competitor never stated: ${[...new Set(claimed)].join(", ")}.\n\n` +
          `A wrong IP rating or wattage is a product defect, not a typo. Publish anyway?`
      );
      if (!ok) return;
    }
    setPublishing(true);
    setResults(null);
    try {
      const content: Parameters<typeof lightingApi.publish>[0]["content"] = {};
      for (const s of draft.selectedStores) {
        const c = draft.content[s];
        if (c)
          content[s] = {
            description: c.description,
            meta_description: c.metaDescription,
            m_title_specs: c.mTitleSpecs,
          };
      }
      const r = await lightingApi.publish({
        stores: draft.selectedStores,
        product_name: draft.productName.trim(),
        product_type: draft.productType.trim(),
        source_url: draft.competitorUrl.trim(),
        option_name: draft.optionName,
        option_values: draft.optionValues,
        price: draft.price,
        compare_at_price: draft.compareAtPrice || undefined,
        images: draft.images.filter((i) => i.selected).map((i) => i.url),
        images_by_value: draft.imagesByValue,
        content,
        tags: draft.tags,
        kaching: draft.kaching,
        bundle_collection: draft.bundleCollection || undefined,
        activate: draft.activate,
      });
      setResults(r.results);
    } catch (e) {
      alert(`Publish failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPublishing(false);
    }
  };

  const scraped = !!draft.sourceText;
  const haveCopy = draft.selectedStores.some((s) => (draft.content[s]?.description ?? "").length > 0);

  const allClaims = useMemo(
    () => [...new Set(draft.selectedStores.flatMap((s) => draft.content[s]?.unverifiedClaims ?? []))],
    [draft.selectedStores, draft.content]
  );

  return (
    <div
      style={{
        ["--accent" as string]: "#f59e0b",
        ["--accent-hover" as string]: "#d97706",
        ["--accent-soft" as string]: "rgba(245,158,11,0.13)",
        ["--accent-glow" as string]: "rgba(245,158,11,0.35)",
        ["--on-accent" as string]: "#0b0f14",
      }}
    >
      <header className="h-15 flex items-center justify-between px-6 lg:px-10 border-b border-border bg-bg-elev sticky top-0 z-40 backdrop-blur">
        <div className="flex items-center gap-5">
          <Logo label="HOME DECOR" sub="Listing Dashboard" />
          <Link href="/" className="text-[12px] text-text-faint hover:text-text transition-colors">
            ← All portals
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {draft.competitorUrl && (
            <button
              onClick={() => {
                if (confirm("Clear this lamp and start over?")) {
                  reset();
                  setResults(null);
                }
              }}
              className="text-[12px] text-text-faint hover:text-danger transition-colors"
            >
              Start over
            </button>
          )}
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="w-full max-w-4xl mx-auto px-6 py-8 space-y-5">
        {knownNotConfigured && (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5">
            <h2 className="text-[14px] font-semibold text-text">The lighting stores aren&apos;t connected yet</h2>
            <p className="text-[12.5px] text-text-dim mt-1.5 leading-relaxed">
              You can already import a lamp and write the copy — publishing needs the Shopify
              credentials for The Light Supplier on the server first. Everything below stays saved.
            </p>
          </div>
        )}

        {/* ⓪ RESEARCH — optional starting point */}
        <details className="rounded-2xl border border-border bg-bg-elev overflow-hidden group">
          <summary className="px-6 lg:px-7 py-4 cursor-pointer list-none flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-text tracking-tight">
                Not sure what to list?
              </h2>
              <p className="text-[12px] text-text-dim mt-0.5">
                See which lamp types people are searching for right now, per market.
              </p>
            </div>
            <span className="text-text-faint text-[12px] group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="px-6 lg:px-7 pb-6">
            <div className="flex gap-1.5 mb-4">
              {STORES.map((s) => (
                <button
                  key={s}
                  onClick={() => setResearchMarket(s)}
                  className={`px-2.5 h-7 rounded-lg border text-[11.5px] transition ${
                    researchMarket === s
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-text-dim hover:border-border-hover"
                  }`}
                >
                  {LIGHT_STORE_CONFIG[s].flag} {LIGHT_STORE_CONFIG[s].label}
                </button>
              ))}
            </div>
            <LightWhatToList market={researchMarket} />
          </div>
        </details>

        {/* ① IMPORT */}
        <Section
          step={1}
          done={scraped}
          title="Import a lamp"
          hint="Paste the competitor's product URL. We read the title, description, variants, price and photos — the description is also the only thing a spec claim (IP rating, wattage, lumen) may be based on."
        >
          <div className="flex gap-2">
            <input
              value={draft.competitorUrl}
              onChange={(e) => patch({ competitorUrl: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && runScrape()}
              placeholder="https://competitor.com/products/hanglamp-goud"
              className="flex-1 px-3 h-10 rounded-[10px] bg-bg-elev-2 border border-border text-[13px] focus:outline-none focus:border-accent"
            />
            <button
              onClick={runScrape}
              disabled={scraping || !draft.competitorUrl.trim()}
              className="px-4 h-10 rounded-[10px] bg-accent text-on-accent text-[13px] font-medium disabled:opacity-40 hover:opacity-90 transition"
            >
              {scraping ? "Reading…" : "Import"}
            </button>
          </div>
          {scrapeError && <p className="text-[12px] text-danger mt-2">{scrapeError}</p>}

          {scraped && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] text-text-dim">Product name (yours)</span>
                <input
                  value={draft.productName}
                  onChange={(e) => patch({ productName: e.target.value })}
                  className="w-full mt-1 px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[13px] focus:outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-text-dim">Product type (e.g. Hanglamp)</span>
                <input
                  value={draft.productType}
                  onChange={(e) => patch({ productType: e.target.value })}
                  placeholder="Hanglamp"
                  className="w-full mt-1 px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[13px] focus:outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-text-dim">Price (ends in .95 automatically)</span>
                <input
                  value={draft.price}
                  onChange={(e) => patch({ price: e.target.value })}
                  placeholder="49"
                  className="w-full mt-1 px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[13px] focus:outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-text-dim">Compare-at price (optional)</span>
                <input
                  value={draft.compareAtPrice}
                  onChange={(e) => patch({ compareAtPrice: e.target.value })}
                  placeholder="79.95"
                  className="w-full mt-1 px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[13px] focus:outline-none focus:border-accent"
                />
              </label>

              <div className="sm:col-span-2">
                <span className="text-[11px] text-text-dim">
                  Variants {draft.optionValues.length > 0 ? `— option “${draft.optionName}”` : ""}
                </span>
                {draft.optionValues.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {draft.optionValues.map((v) => (
                      <span
                        key={v}
                        className="px-2 py-1 rounded-lg border border-border bg-bg-elev-2 text-[11.5px] text-text-dim"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-text-faint mt-1.5">
                    One variant, no options — published as a single product.
                  </p>
                )}
                <p className="text-[10.5px] text-text-faint mt-2">
                  One product with its own variants — no duplicate product per colour (that&apos;s the
                  Vionna model, and your lighting stores don&apos;t use it).
                </p>
              </div>

              {draft.images.length > 0 && (
                <div className="sm:col-span-2">
                  <span className="text-[11px] text-text-dim">
                    Photos ({draft.images.filter((i) => i.selected).length} of {draft.images.length} selected)
                  </span>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {draft.images.map((im, i) => (
                      <button
                        key={im.url}
                        onClick={() => {
                          const next = [...draft.images];
                          next[i] = { ...next[i], selected: !next[i].selected };
                          patch({ images: next });
                        }}
                        className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition ${
                          im.selected ? "border-accent" : "border-border opacity-40"
                        }`}
                        title={im.selected ? "Selected — click to skip" : "Skipped — click to include"}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={im.url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ② COPY */}
        {scraped && (
          <Section
            step={2}
            done={haveCopy}
            title="Write the copy"
            hint="Each market gets its own text in its own language. Colour and finish are welcome here — a lamp is one product, so “zwarte hanglamp” is a keyword, not a problem."
          >
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {STORES.map((s) => {
                const on = draft.selectedStores.includes(s);
                const ready = configured.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() =>
                      patch({
                        selectedStores: on
                          ? draft.selectedStores.filter((x) => x !== s)
                          : [...draft.selectedStores, s],
                      })
                    }
                    className={`px-3 h-8 rounded-[10px] border text-[12px] transition ${
                      on ? "border-accent bg-accent/10 text-accent" : "border-border text-text-dim hover:border-border-hover"
                    }`}
                    title={ready ? `${LIGHT_STORE_CONFIG[s].language}` : "Store not connected yet — copy still works"}
                  >
                    {LIGHT_STORE_CONFIG[s].flag} {LIGHT_STORE_CONFIG[s].label}
                    {!ready && <span className="ml-1 text-text-faint">·</span>}
                  </button>
                );
              })}
              <span className="flex-1" />
              <button
                onClick={generateAll}
                disabled={!!generating || draft.selectedStores.length === 0}
                className="px-3 h-8 rounded-[10px] bg-accent text-on-accent text-[12px] font-medium disabled:opacity-40 hover:opacity-90 transition"
              >
                {generating ? `Writing ${LIGHT_STORE_CONFIG[generating].label}…` : "Generate copy"}
              </button>
            </div>

            {allClaims.length > 0 && (
              <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 mb-4">
                <p className="text-[12px] text-text">
                  <strong>Check these specs:</strong> the copy claims {allClaims.join(", ")}, which the
                  competitor&apos;s page never states.
                </p>
                <p className="text-[11px] text-text-dim mt-1">
                  A wrong IP rating on a bathroom lamp is a safety claim, not a marketing detail. Edit
                  the text, or publish anyway if you know it&apos;s right.
                </p>
              </div>
            )}

            <div className="space-y-4">
              {draft.selectedStores.map((s) => {
                const c = draft.content[s];
                return (
                  <div key={s} className="rounded-xl border border-border bg-bg-elev-2 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-semibold text-text">
                        {LIGHT_STORE_CONFIG[s].flag} {LIGHT_STORE_CONFIG[s].label} · {LIGHT_STORE_CONFIG[s].language}
                      </span>
                      <button
                        onClick={() => generateFor(s)}
                        disabled={generating === s}
                        className="text-[11px] text-accent hover:underline disabled:opacity-40"
                      >
                        {c ? "↻ Rewrite" : "Write"}
                      </button>
                    </div>
                    {c ? (
                      <>
                        {c.sourceSpecs.length > 0 && (
                          <p className="text-[10.5px] text-text-faint mb-2">
                            Specs the source states (safe to use): {c.sourceSpecs.join(", ")}
                          </p>
                        )}
                        <textarea
                          value={c.description}
                          onChange={(e) => patchContent(s, { description: e.target.value })}
                          rows={8}
                          className="w-full px-3 py-2 rounded-[10px] bg-bg-elev border border-border text-[12px] leading-relaxed focus:outline-none focus:border-accent resize-y"
                        />
                        <input
                          value={c.metaDescription}
                          onChange={(e) => patchContent(s, { metaDescription: e.target.value })}
                          placeholder="Meta description"
                          className="w-full mt-2 px-3 h-9 rounded-[10px] bg-bg-elev border border-border text-[12px] focus:outline-none focus:border-accent"
                        />
                        <input
                          value={c.mTitleSpecs}
                          onChange={(e) => patchContent(s, { mTitleSpecs: e.target.value })}
                          placeholder="Google Shopping title suffix"
                          className="w-full mt-2 px-3 h-9 rounded-[10px] bg-bg-elev border border-border text-[12px] focus:outline-none focus:border-accent"
                        />
                      </>
                    ) : (
                      <p className="text-[12px] text-text-faint">Not written yet.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ③ PUBLISH */}
        {haveCopy && (
          <Section
            step={3}
            done={!!results}
            title="Publish"
            hint="Creates one product per store as a draft. Nothing goes live until you tick the box below."
          >
            <div className="space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.kaching}
                  onChange={(e) => patch({ kaching: e.target.checked })}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span className="text-[12.5px] text-text">
                  Put on the Kaching bundle template
                  <span className="block text-[11px] text-text-dim mt-0.5">
                    Kaching has no API, so the bundle follows the product template
                    (<code className="text-[10.5px]">kaching-standaard</code>) plus the collection its
                    deal targets. Set your deal to a collection once and every new lamp inherits it.
                  </span>
                </span>
              </label>

              {draft.kaching && (
                <label className="block ml-6">
                  <span className="text-[11px] text-text-dim">Bundle collection handle (optional)</span>
                  <input
                    value={draft.bundleCollection}
                    onChange={(e) => patch({ bundleCollection: e.target.value })}
                    placeholder="bundel-deals"
                    className="w-full mt-1 px-3 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[12px] focus:outline-none focus:border-accent"
                  />
                </label>
              )}

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.activate}
                  onChange={(e) => patch({ activate: e.target.checked })}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span className="text-[12.5px] text-text">
                  Publish live immediately
                  <span className="block text-[11px] text-text-dim mt-0.5">
                    Off = created as a draft so you can check it in Shopify first. Recommended.
                  </span>
                </span>
              </label>

              <button
                onClick={runPublish}
                disabled={!readyToPublish || publishing || knownNotConfigured}
                className="px-4 h-10 rounded-[10px] bg-accent text-on-accent text-[13px] font-medium disabled:opacity-40 hover:opacity-90 transition"
                title={
                  knownNotConfigured
                    ? "The lighting stores aren't connected on the server yet"
                    : !readyToPublish
                      ? "Needs a name, a price and copy for every selected market"
                      : ""
                }
              >
                {publishing
                  ? "Publishing…"
                  : `Publish to ${draft.selectedStores.length} store${draft.selectedStores.length === 1 ? "" : "s"}`}
              </button>
            </div>

            {results && (
              <div className="mt-5 space-y-2">
                {Object.entries(results).map(([store, r]) => (
                  <div
                    key={store}
                    className={`rounded-xl border p-3 ${
                      r.error ? "border-danger/40 bg-danger/10" : "border-border bg-bg-elev-2"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-text">
                        {LIGHT_STORE_CONFIG[store as LightStore]?.flag} {store.toUpperCase()}
                      </span>
                      {r.admin_url && (
                        <a
                          href={r.admin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-accent hover:underline"
                        >
                          Open in Shopify ↗
                        </a>
                      )}
                    </div>
                    {r.error ? (
                      <p className="text-[11.5px] text-danger mt-1">{r.error}</p>
                    ) : (
                      <p className="text-[11.5px] text-text-dim mt-1">
                        {r.reused
                          ? `Already existed (${r.status}) — reused, no duplicate created.`
                          : `Created: ${r.variants} variant${r.variants === 1 ? "" : "s"}, ${r.images} photo${
                              r.images === 1 ? "" : "s"
                            }, ${r.activated ? "live" : "draft"}.`}
                      </p>
                    )}
                    {(r.metafield_errors ?? []).length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {r.metafield_errors!.map((e) => (
                          <li key={e} className="text-[10.5px] text-warning">
                            ⚠ {e}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </main>
    </div>
  );
}
