"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { useLightProduct, type LightBrief, type LightContent } from "@/lib/lightProduct";
import { LightWhatToList } from "./LightWhatToList";
import { LightStoreConnect } from "./LightStoreConnect";
import { ManualPasteModal } from "@/components/steps/ManualPasteModal";
import { classifyScrapeError, isShopRefusal } from "@/lib/scrapeError";
import { BODY_TEXT_THIN, bodyHtmlText } from "@/lib/browserScrape";

/** The API helper throws "API /api/scrape → 429: {json}"; show the operator the
 *  server's own sentence, not the envelope. */
function cleanApiError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/^API \S+ → \d+: ([\s\S]*)$/);
  if (!m) return msg;
  try {
    const body = JSON.parse(m[1]) as { error?: string };
    if (body && typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* truncated JSON — fall through to the raw text */
  }
  return m[1];
}

const STORES: LightStore[] = ["nl", "de", "com"];

/** Strip HTML → plain text. This is what a spec claim is checked against.
 *  One tokenizer for "is the .json body thin?" everywhere (lib/browserScrape). */
const toPlainText = bodyHtmlText;

/** Only a type the operator TYPED is the operator's word; the one the brief
 *  filled in belongs to the model's reading and must not be sent back as
 *  operator truth (it would lock a wrong family — review of #67/#68). */
function typedTypeOf(d: { productType: string; brief?: { type?: { nl?: string } } | null }): string {
  const t = d.productType.trim();
  return t && t !== (d.brief?.type?.nl ?? "").trim() ? t : "";
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
  const { draft, patch, patchContent, setKeywords, toggleKeyword, reset } = useLightProduct();
  const [status, setStatus] = useState<LightStatusResponse | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  // Where the product came from when it was NOT our server: the shop refused
  // the droplet's IP and the dashboard read it from the operator's browser
  // (automatic) or the operator pasted it (manual fallback).
  const [importNote, setImportNote] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteReason, setPasteReason] = useState<"block" | "rate-limit">("rate-limit");
  // Where the description came from (the .json, the page itself, or nowhere)
  // and which option we did NOT turn into variants ("Pack" next to "Color").
  const [sourceNote, setSourceNote] = useState<string | null>(null);
  const [optionNote, setOptionNote] = useState<string | null>(null);
  const [generating, setGenerating] = useState<LightStore | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<Record<string, LightPublishResult> | null>(null);
  const [researchMarket, setResearchMarket] = useState<LightStore>("nl");
  const [kwLoading, setKwLoading] = useState(false);
  const [kwNote, setKwNote] = useState<string | null>(null);
  // Import-time understanding of the product (one LLM read of the competitor's text).
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const briefSeq = useRef(0);
  // Bundle picker: your own collections + what the competitor runs.
  const [collections, setCollections] = useState<{ title: string; handle: string; products: number }[]>([]);
  const [bundleInfo, setBundleInfo] = useState<{
    summary: string;
    detected_app: string | null;
    readable: boolean;
    suggestion: { handle: string; title: string; why: string[] } | null;
  } | null>(null);

  useEffect(() => {
    lightingApi.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  // Bundle collections come from the first connected store — the deal lives in
  // Kaching, we only decide which collection the product lands in.
  useEffect(() => {
    const first = status?.ready?.[0];
    if (!first) return;
    lightingApi
      .bundleCollections(first)
      .then((r) => setCollections(r.collections ?? []))
      .catch(() => setCollections([]));
  }, [status]);

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
    setBriefError(null);
    setImportNote(null);
    setPasteOpen(false);
    // A type the previous brief filled in belongs to the PREVIOUS lamp; only a
    // type the operator typed themselves carries over to the next import.
    // Otherwise a hanglamp's auto-filled type would anchor the next stekkerlamp
    // with "operator" authority.
    const typedType = typedTypeOf(draft);
    try {
      let p: NonNullable<ScrapedProduct["product"]>;
      let pageText: string | null | undefined;
      try {
        const res: ScrapedProduct = await api.scrape(url);
        if (res.error || !res.product) throw new Error(res.error || "Nothing came back");
        p = res.product;
        pageText = res.page_text;
      } catch (e) {
        const msg = cleanApiError(e);
        const failure = classifyScrapeError(msg);
        // Only a shop that refuses OUR server: a 502 while the droplet
        // restarts, or a timeout, is not "this shop blocks us".
        if (failure === "other" || !isShopRefusal(msg)) throw new Error(msg);
        // The shop refuses OUR server's IP (429 / anti-bot wall), not the
        // product: the same URL answers a normal browser at once. Shopify's
        // product .json allows cross-origin reads, so read it from THIS
        // browser — the operator's residential IP — and validate it through
        // the same path a manual paste takes. Zero clicks instead of 30 s.
        setPasteReason(failure);
        setImportNote(
          failure === "rate-limit"
            ? "This shop is rate-limiting our server — reading it from your browser instead…"
            : "This shop blocks our server — reading it from your browser instead…"
        );
        const viaBrowser = await api.scrapeFromBrowser(url);
        if (viaBrowser.error || !viaBrowser.product) {
          setImportNote(null);
          throw new Error(
            `${msg} Reading it from your browser did not work either (${viaBrowser.error || "no product came back"}). ` +
              "Use \"Paste JSON manually\" below: open the product JSON in a new tab and paste it back."
          );
        }
        p = viaBrowser.product;
        pageText = viaBrowser.page_text;
        setImportNote(
          failure === "rate-limit"
            ? "Read from your browser — this shop is rate-limiting our server."
            : "Read from your browser — this shop blocks our server."
        );
      }
      applyProduct(p, url, typedType, pageText);
    } catch (e) {
      setScrapeError(cleanApiError(e));
    } finally {
      setScraping(false);
    }
  };

  /** Everything after we HAVE the competitor's product, whichever way it came
   *  in: our server, the operator's browser, or a manual paste. */
  const applyProduct = (
    p: NonNullable<ScrapedProduct["product"]>,
    url: string,
    typedType: string,
    pageText?: string | null
  ) => {
    // The description: the .json body when the shop filled it, else the text of
    // the product PAGE (theme-section shops leave body_html empty — aorabrand.co
    // had the whole story only on the page). Nothing at all → say so, and let
    // the operator paste it: copy without a source is copy without facts.
    const bodyText = toPlainText(p.body_html ?? "");
    const fromPage = bodyText.length < BODY_TEXT_THIN && !!(pageText && pageText.trim());
    // A short-but-real body is kept in front of the page text, not replaced.
    const descText = fromPage ? [bodyText, (pageText as string).trim()].filter(Boolean).join("\n") : bodyText;
    const sourceText = [p.title ?? "", descText].join(" ").trim().slice(0, 4000);
    setSourceNote(
      fromPage
        ? "The product JSON had no description — this was read from the product page itself. Check it before you continue."
        : bodyText.length < BODY_TEXT_THIN
          ? "No description found: the product JSON is empty and the page could not be read. Paste the competitor's description here so the copy has facts to work with, then press Re-read."
          : null
    );

    // The variant axis, exactly as this product has it. The live catalogue uses
    // Kleur, Color, Design and light-colour — so read it, never assume "colour".
    // With several multi-value options (Aoraglow: "Pack" 2/4/6/8 + "Color"),
    // the colour-like one becomes the variants; the others are shown as a note.
    const multi = (p.options ?? []).filter((o) => (o.values ?? []).length > 1);
    const colourish = multi.find((o) => /colou?r|kleur|farbe|finish|design|licht|light|tint/i.test(o.name ?? ""));
    const opt = colourish ?? multi[0] ?? (p.options ?? [])[0];
    const optionName = opt?.name && opt.name !== "Title" ? opt.name : "";
    const optionValues = optionName ? (opt?.values ?? []).filter(Boolean) : [];
    const others = multi.filter((o) => o !== opt);
    setOptionNote(
      others.length
        ? `Not imported as variants: ${others
            .map((o) => `${o.name} (${(o.values ?? []).join(", ")})`)
            .join("; ")}. The price below is the first variant's — check it against a single unit.`
        : null
    );

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
    // The chosen option may be option2 (Color next to Pack): read the value
    // from the matching position, never blindly option1.
    const optIndex = Math.max(0, (p.options ?? []).findIndex((o) => o === opt));
    const optKey = (opt?.position ? `option${opt.position}` : `option${optIndex + 1}`) as "option1" | "option2" | "option3";
    const valueOf = (v: NonNullable<ScrapedProduct["product"]>["variants"] extends (infer V)[] | undefined ? V : never) =>
      (v[optKey] ?? v.option1 ?? "") as string;
    const valueByVariantId = new Map<number, string>();
    for (const v of p.variants ?? []) {
      const val = valueOf(v);
      if (v.id && val) valueByVariantId.set(v.id, val);
    }
    for (const im of p.images ?? []) {
      for (const vid of im.variant_ids ?? []) {
        const val = valueByVariantId.get(vid);
        if (val) (byValue[val] ||= []).push(abs(im.src));
      }
    }
    for (const v of p.variants ?? []) {
      const val = valueOf(v);
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
      productType: typedType,
      content: {},
      brief: null,
    });
    understandProduct(sourceText, p.title ?? "", typedType);
    // Read the competitor's bundle so we can suggest a matching one of yours.
    // Never blocks the import — no readable bundle just means no suggestion.
    lightingApi
      .bundleSuggest(url, draft.selectedStores[0] ?? "nl")
      .then((b) => {
        setBundleInfo(b);
        if (b.suggestion && !draft.bundleCollection) {
          patch({ bundleCollection: b.suggestion.handle });
        }
      })
      .catch(() => setBundleInfo(null));
  };

  /** Understand WHAT the product is (type per market, power, placement,
   *  features, search terms) from the competitor's own text. Seeds the keyword
   *  research and anchors the copy; fills the type if it is empty. Never blocks
   *  the import — no brief just means the old, guessier path. Runs again from
   *  "Re-read" after the operator edits or pastes the source text. The sequence
   *  number makes sure a slow answer for an EARLIER import (or one from before
   *  "Start over") never lands on the current lamp. */
  const understandProduct = (sourceText: string, title: string, typedType: string) => {
    const seq = ++briefSeq.current;
    setBriefError(null);
    setBriefLoading(true);
    lightingApi
      .understand({ source_text: sourceText, product_title: title, product_type: typedType })
      .then((b) => {
        if (seq !== briefSeq.current) return;
        if (b.error || !b.ok) {
          setBriefError((b.error || "could not read the product").replace(/^Could not read the product:\s*/i, ""));
          return;
        }
        const brief = b as LightBrief;
        // Read the LIVE draft: the operator may have typed a type while the
        // call was running, and the operator always wins over the model.
        patch((d) => ({
          brief,
          productType: d.productType.trim() || brief.type?.nl || "",
        }));
      })
      .catch((e) => {
        if (seq !== briefSeq.current) return;
        setBriefError((e instanceof Error ? e.message : String(e)).replace(/^Could not read the product:\s*/i, ""));
      })
      .finally(() => {
        if (seq === briefSeq.current) setBriefLoading(false);
      });
  };

  // ── Step 2a: keyword research per market ──────────────────────────────────
  /** Real Google search volume per market, same engine as the fashion flow. The
   *  seeds are derived from the product itself — never the product NAME, which
   *  is a brand ("AMBIENTIFY Bottle") and researches badly. */
  const researchKeywords = async () => {
    if (!draft.sourceText || kwLoading || draft.selectedStores.length === 0) return;
    setKwLoading(true);
    setKwNote(null);
    try {
      const r = await api.researchKeywords({
        stores: draft.selectedStores,
        product_name: draft.productName,
        competitor_title: draft.competitorTitle,
        // The TYPE the operator typed anchors the research. Without it a
        // "Stekkerlamp" was researched as "hanglamp" (the most common lamp word).
        category: draft.productType.trim(),
        description: draft.sourceText,
        // Seeds from the import-time understanding: what shoppers type for
        // THIS kind of product, per market. Volume then ranks them.
        seed_terms: draft.brief?.search_terms ?? undefined,
        // Keywords may not claim a power source the product does not have
        // ('oplaadbare lamp' for a plug-in lamp), however popular.
        power: draft.brief?.power || undefined,
      });
      if (!r.configured) {
        setKwNote(r.message || "Keyword research isn't switched on for this server yet.");
        return;
      }
      let found = 0;
      for (const s of draft.selectedStores) {
        const kws = (r.results?.[s]?.keywords ?? [])
          .filter((k) => k.keyword)
          .map((k) => ({
            keyword: k.keyword,
            volume: k.volume ?? null,
            recommended: !!k.recommended,
            // Pre-tick what the engine recommends; the operator adjusts.
            selected: !!k.recommended,
          }));
        found += kws.length;
        setKeywords(s, kws);
      }
      if (found === 0) {
        setKwNote(
          "No keywords came back — usually the search volume for this lamp type is below the threshold, not that there's no demand."
        );
      }
    } catch (e) {
      setKwNote(e instanceof Error ? e.message : String(e));
    } finally {
      setKwLoading(false);
    }
  };

  // ── Step 2b: copy per market ──────────────────────────────────────────────
  const generateFor = async (store: LightStore) => {
    if (!draft.sourceText) return;
    setGenerating(store);
    try {
      const r = await lightingApi.generate({
        store,
        product_name: draft.productName,
        product_title: draft.competitorTitle,
        // The typed TYPE goes with the copy: a "Stekkerlamp" was written up as a
        // "glazen hanglamp voor eettafel" because the writer never saw the type.
        product_type: draft.productType.trim(),
        brief: draft.brief ?? undefined,
        source_text: draft.sourceText,
        keywords: (draft.keywords[store] ?? []).filter((k) => k.selected).map((k) => k.keyword),
      });
      if (r.error) throw new Error(r.error);
      if (r.type_dropped?.length) {
        // Same anchor the backend uses: typed type, else the brief's type.
        const anchor = draft.productType.trim() || draft.brief?.type?.nl || "unknown";
        setKwNote(
          `Left out of the ${LIGHT_STORE_CONFIG[store].label} copy — not a "${anchor}": ${r.type_dropped.join(", ")}. Untick them, or change the product type if it is wrong.`
        );
      }
      const c: LightContent = {
        description: r.description ?? "",
        metaDescription: r.meta_description ?? "",
        mTitleSpecs: r.m_title_specs ?? "",
        unverifiedClaims: r.unverified_claims ?? [],
        sourceSpecs: r.source_specs ?? [],
        languageMismatch: !!r.language_mismatch,
        typeMismatch: r.type_mismatch ?? [],
        claimMismatch: r.claim_mismatch ?? [],
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

  /** Publishes. `ack` = the operator already said "yes, publish anyway" to the
   *  server's spec warning. The server does the real check against the actual
   *  text (this component's warning is only a generation-time snapshot). */
  const runPublish = async (ack = false) => {
    if (!readyToPublish || publishing) return;
    setPublishing(true);
    setResults(null);
    try {
      const selectedUrls = draft.images.filter((i) => i.selected).map((i) => i.url);
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
        images: selectedUrls,
        // Only map variants to photos that are actually being uploaded —
        // otherwise a de-selected photo would be requested for a variant.
        images_by_value: Object.fromEntries(
          Object.entries(draft.imagesByValue)
            .map(([val, urls]) => [val, urls.filter((u) => selectedUrls.includes(u))])
            .filter(([, urls]) => (urls as string[]).length > 0)
        ),
        content,
        source_text: draft.sourceText,
        product_title: draft.competitorTitle,
        ack_claims: ack,
        tags: draft.tags,
        kaching: draft.kaching,
        bundle_collection: draft.bundleCollection || undefined,
        activate: draft.activate,
      });

      // The server refuses once when the copy claims specs the source doesn't.
      // Warn-never-block: the operator can confirm and it goes through — but the
      // decision is logged, not just remembered.
      if (r.needs_claim_ack && !ack) {
        const lines = Object.entries(r.claim_report ?? {}).map(([st, rep]) => {
          const bits = [
            rep.unverified.length ? `not stated by the source: ${rep.unverified.join(", ")}` : "",
            rep.conflicting.length ? `CONTRADICTED by the source: ${rep.conflicting.join(", ")}` : "",
          ].filter(Boolean);
          return `${st.toUpperCase()} — ${bits.join(" · ")}`;
        });
        const ok = confirm(
          `Check the specs before this goes live:\n\n${lines.join("\n")}\n\n` +
            `A wrong IP rating or wattage is a product defect, not a typo. Publish anyway?`
        );
        if (ok) await runPublish(true);
        return;
      }
      setResults(r.results);
    } catch (e) {
      alert(`Publish failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPublishing(false);
    }
  };

  // Imported = we have a competitor product, even when the operator empties the
  // source textarea to paste a new description (that must not unmount the panel).
  const scraped = !!(draft.competitorTitle || draft.sourceText || draft.images.length);
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
                  // Invalidate an in-flight understand call and its error.
                  briefSeq.current += 1;
                  setBriefLoading(false);
                  setBriefError(null);
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
        <LightStoreConnect status={status} onChanged={setStatus} />

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
          {scrapeError && classifyScrapeError(scrapeError) !== "other" && (
            <button
              type="button"
              onClick={() => setPasteOpen(true)}
              className="mt-2 px-3 h-8 rounded-[10px] border border-border bg-bg-elev-2 text-[12px] text-text hover:border-accent transition"
            >
              ⌨ Paste JSON manually
            </button>
          )}
          {importNote && !scrapeError && <p className="text-[12px] text-text-dim mt-2">{importNote}</p>}
          <ManualPasteModal
            open={pasteOpen}
            originalUrl={draft.competitorUrl}
            reason={pasteReason}
            onClose={() => setPasteOpen(false)}
            onSuccess={(p) => {
              setPasteOpen(false);
              setScrapeError(null);
              setImportNote("Pasted from your browser — this shop refuses our server.");
              applyProduct(p, draft.competitorUrl.trim(), typedTypeOf(draft));
            }}
          />

          {scraped && (briefLoading || briefError || draft.brief) && (
            <div className="mt-4 rounded-xl border border-border bg-bg-elev-2 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-text-dim uppercase tracking-wide">What this product is</span>
                <span className="text-[10.5px] text-text-faint">read from the competitor&apos;s text</span>
              </div>
              {briefLoading && <p className="text-[12px] text-text-dim mt-2">Reading the competitor&apos;s description…</p>}
              {briefError && !briefLoading && (
                <p className="text-[12px] text-danger mt-2">
                  Could not read the product ({briefError}). Fill in the product type yourself — research and copy still work,
                  just with less to go on.
                </p>
              )}
              {draft.brief && !briefLoading && (
                <div className="mt-2 space-y-1.5 text-[12px] text-text">
                  <p>{draft.brief.what}</p>
                  <p className="text-text-dim">
                    <strong className="text-text">Type:</strong> {draft.brief.type?.nl || "—"} · DE {draft.brief.type?.de || "—"} · EN{" "}
                    {draft.brief.type?.com || "—"}
                    {draft.brief.family_source === "operator" && (
                      <span className="text-text-faint"> (from your product type)</span>
                    )}
                  </p>
                  {(draft.brief.power || draft.brief.placement) && (
                    <p className="text-text-dim">
                      {draft.brief.power && (
                        <>
                          <strong className="text-text">Power:</strong> {draft.brief.power}
                        </>
                      )}
                      {draft.brief.power && draft.brief.placement && " · "}
                      {draft.brief.placement && (
                        <>
                          <strong className="text-text">Placement:</strong> {draft.brief.placement}
                        </>
                      )}
                    </p>
                  )}
                  {draft.brief.features.length > 0 && (
                    <p className="text-text-dim">
                      <strong className="text-text">Features:</strong> {draft.brief.features.join(" · ")}
                    </p>
                  )}
                  {Object.keys(draft.brief.search_terms ?? {}).length > 0 && (
                    <p className="text-text-faint text-[11px]">
                      Search terms for the keyword research:{" "}
                      {(["nl", "de", "com"] as LightStore[])
                        .filter((m) => (draft.brief?.search_terms?.[m]?.length ?? 0) > 0)
                        .map((m) => `${m.toUpperCase()}: ${draft.brief!.search_terms[m]!.join(", ")}`)
                        .join(" · ")}
                    </p>
                  )}
                  {(draft.brief.terms_dropped?.length ?? 0) > 0 && (
                    <p className="text-text-faint text-[11px]">
                      Left out (another kind of lamp): {draft.brief.terms_dropped!.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {scraped && (
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-dim">
                  Competitor description — the only source a claim may come from
                </span>
                <button
                  type="button"
                  onClick={() => understandProduct(draft.sourceText, draft.competitorTitle, typedTypeOf(draft))}
                  disabled={briefLoading || !draft.sourceText.trim()}
                  className="text-[11px] text-accent hover:underline disabled:opacity-40"
                >
                  {briefLoading ? "Reading…" : "↻ Re-read product"}
                </button>
              </div>
              <textarea
                value={draft.sourceText}
                onChange={(e) => patch({ sourceText: e.target.value })}
                rows={4}
                spellCheck={false}
                className="w-full mt-1 px-3 py-2 rounded-[10px] bg-bg-elev-2 border border-border text-[12px] leading-relaxed focus:outline-none focus:border-accent resize-y"
              />
              {sourceNote && (
                <p className={`text-[11.5px] mt-1.5 ${sourceNote.startsWith("No description") ? "text-danger" : "text-text-dim"}`}>
                  {sourceNote}
                </p>
              )}
            </div>
          )}

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
                {optionNote && <p className="text-[11.5px] text-warning mt-1.5">{optionNote}</p>}
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
            hint="Each market gets its own text in its own language. Find the keywords first if you want the copy built around what people actually search for. Colour and finish are welcome here — a lamp is one product, so “zwarte hanglamp” is a keyword, not a problem."
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
                onClick={researchKeywords}
                disabled={kwLoading || !!generating || draft.selectedStores.length === 0}
                className="px-3 h-8 rounded-[10px] border border-border text-[12px] text-text-dim hover:border-accent hover:text-accent disabled:opacity-40 transition"
                title="Find what people actually search for this lamp type, per market"
              >
                {kwLoading ? "Researching…" : "🔍 Find keywords"}
              </button>
              <button
                onClick={generateAll}
                disabled={!!generating || draft.selectedStores.length === 0}
                className="px-3 h-8 rounded-[10px] bg-accent text-on-accent text-[12px] font-medium disabled:opacity-40 hover:opacity-90 transition"
              >
                {generating ? `Writing ${LIGHT_STORE_CONFIG[generating].label}…` : "Generate copy"}
              </button>
            </div>

            {kwNote && <p className="text-[11.5px] text-text-dim mb-3">{kwNote}</p>}

            {/* Keyword picker per market — ticked ones seed the copy */}
            {draft.selectedStores.some((s) => (draft.keywords[s] ?? []).length > 0) && (
              <div className="rounded-xl border border-border bg-bg-elev-2 p-4 mb-4">
                <p className="text-[11.5px] text-text-dim mb-3 leading-relaxed">
                  Real monthly searches per market. Ticked keywords are woven into the copy — starred
                  ones are the engine&apos;s pick. Colour and finish are fair game here (&ldquo;zwarte
                  hanglamp&rdquo; is a real search); specs the source never states are not.
                </p>
                <div className="space-y-3">
                  {draft.selectedStores.map((s) => {
                    const kws = draft.keywords[s] ?? [];
                    if (kws.length === 0) return null;
                    const picked = kws.filter((k) => k.selected).length;
                    return (
                      <div key={s}>
                        <div className="text-[11px] text-text-faint mb-1.5">
                          {LIGHT_STORE_CONFIG[s].flag} {LIGHT_STORE_CONFIG[s].label} · {picked} of {kws.length} selected
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {kws.map((k) => (
                            <button
                              key={k.keyword}
                              onClick={() => toggleKeyword(s, k.keyword)}
                              className={`px-2 py-1 rounded-lg border text-[11.5px] transition ${
                                k.selected
                                  ? "border-accent bg-accent/10 text-accent"
                                  : "border-border text-text-dim hover:border-border-hover"
                              }`}
                              title={k.volume != null ? `${k.volume.toLocaleString("en-US")} searches/month` : "volume unknown"}
                            >
                              {k.recommended && <span className="mr-1">★</span>}
                              {k.keyword}
                              {k.volume != null && (
                                <span className="ml-1.5 text-text-faint tabular-nums">
                                  {k.volume.toLocaleString("en-US")}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
                        {c.languageMismatch && (
                          <p className="text-[11px] text-danger mb-2">
                            This text is not in {LIGHT_STORE_CONFIG[s].language}, even after a retry. Rewrite before publishing.
                          </p>
                        )}
                        {(c.typeMismatch?.length ?? 0) > 0 && (
                          <p className="text-[11px] text-danger mb-2">
                            The copy calls this a different kind of lamp ({c.typeMismatch!.join(", ")}) while the product type is
                            &quot;{draft.productType.trim() || draft.brief?.type?.nl || "unknown"}&quot;. Rewrite, or fix the product type.
                          </p>
                        )}
                        {(c.claimMismatch?.length ?? 0) > 0 && (
                          <p className="text-[11px] text-danger mb-2">
                            The copy claims {c.claimMismatch!.join(", ")} and the competitor never says that, even after a
                            retry. Rewrite, or take it out by hand.
                          </p>
                        )}
                        {c.sourceSpecs.length > 0 && (
                          <p className="text-[10.5px] text-text-faint mb-2">
                            Specs the source states (safe to use): {c.sourceSpecs.join(", ")}
                          </p>
                        )}
                        <textarea
                          value={c.description}
                          onChange={(e) =>
                            // The flags describe the GENERATED text; a hand edit clears them.
                            patchContent(s, {
                              description: e.target.value,
                              languageMismatch: false,
                              typeMismatch: [],
                              claimMismatch: [],
                            })
                          }
                          rows={8}
                          className="w-full px-3 py-2 rounded-[10px] bg-bg-elev border border-border text-[12px] leading-relaxed focus:outline-none focus:border-accent resize-y"
                        />
                        <input
                          value={c.metaDescription}
                          onChange={(e) => patchContent(s, { metaDescription: e.target.value, typeMismatch: [] })}
                          placeholder="Meta description"
                          className="w-full mt-2 px-3 h-9 rounded-[10px] bg-bg-elev border border-border text-[12px] focus:outline-none focus:border-accent"
                        />
                        <input
                          value={c.mTitleSpecs}
                          onChange={(e) => patchContent(s, { mTitleSpecs: e.target.value, typeMismatch: [] })}
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
                  Use the custom product template
                  <span className="block text-[11px] text-text-dim mt-0.5">
                    Puts the product on <code className="text-[10.5px]">kaching-standaard</code>. Note this
                    does <strong>not</strong> switch the bundle on — measured on the live store, the bundle
                    block is injected on every product page regardless of template. What decides whether a
                    bundle actually shows is the collection your Kaching deal targets, below.
                  </span>
                </span>
              </label>

              <div className="ml-6">
                <span className="text-[11px] text-text-dim">
                  Bundle — <strong>this is what turns the Kaching deal on</strong>
                </span>

                {/* What the competitor runs, and which of yours matches it. */}
                {bundleInfo && (
                  <div className="mt-1.5 mb-2 rounded-[10px] border border-border bg-bg-elev-2 px-3 py-2">
                    {bundleInfo.readable ? (
                      <>
                        <p className="text-[11.5px] text-text">
                          Competitor runs: <strong>{bundleInfo.summary}</strong>
                        </p>
                        {bundleInfo.suggestion ? (
                          <p className="text-[11px] text-text-dim mt-1">
                            Closest of yours: <strong className="text-accent">{bundleInfo.suggestion.title}</strong>
                            {bundleInfo.suggestion.why.length > 0 && (
                              <> — matched on {bundleInfo.suggestion.why.join(", ")}</>
                            )}
                            {draft.bundleCollection === bundleInfo.suggestion.handle
                              ? " · selected"
                              : ""}
                          </p>
                        ) : (
                          <p className="text-[11px] text-text-dim mt-1">
                            None of your bundle collections matches those numbers — pick one below.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-[11.5px] text-text-dim">
                        {bundleInfo.detected_app
                          ? `They run ${bundleInfo.detected_app}, which doesn't expose its deal — pick a bundle yourself.`
                          : "No bundle found on the competitor's page — pick one yourself if you want one."}
                      </p>
                    )}
                  </div>
                )}

                <select
                  value={draft.bundleCollection}
                  onChange={(e) => patch({ bundleCollection: e.target.value })}
                  className="w-full mt-1 px-2 h-9 rounded-[10px] bg-bg-elev-2 border border-border text-[12px] text-text focus:outline-none focus:border-accent"
                >
                  <option value="">No bundle</option>
                  {collections.map((c) => (
                    <option key={c.handle} value={c.handle}>
                      {c.title}
                      {bundleInfo?.suggestion?.handle === c.handle ? "  ← suggested" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[10.5px] text-text-faint mt-1">
                  The product is added to this collection, and your Kaching deal for that collection
                  does the rest. {collections.length === 0 && "Connect a store to load your collections."}
                </p>
              </div>

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
                // NOT onClick={runPublish}: that hands the MouseEvent to `ack`,
                // and an event is truthy — the spec gate would be skipped.
                onClick={() => void runPublish()}
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
