"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Field, Label, Input, Textarea } from "@/components/ui/Field";
import { useProduct } from "@/lib/product";
import { useStore, STORE_CONFIG } from "@/lib/store";
import { api, GenerateField } from "@/lib/api";
import { loadToneReferences } from "@/lib/toneReference";

export function GeneratedContentCard() {
  const { data, patch } = useProduct();
  const { store } = useStore();
  const langFlag = { dk: "🇩🇰", fr: "🇫🇷", fi: "🇫🇮" }[store];
  const language = STORE_CONFIG[store].language;

  const metaCount = data.metaDescription.length;
  const metaWarn  = metaCount > 155;

  // Per-field regenerate spinner state
  const [regenerating, setRegenerating] = useState<Record<GenerateField, boolean>>({
    description: false,
    meta_description: false,
    m_title_specs: false,
  });

  const regenerate = async (field: GenerateField) => {
    if (regenerating[field]) return;
    setRegenerating((s) => ({ ...s, [field]: true }));
    try {
      const toneRefs = loadToneReferences();
      const res = await api.generate({
        store,
        product_name: data.name,
        product_title: data.competitor?.title ?? "",
        keywords: data.parsedKeywords,
        only_field: field,
        current_description: data.description,
        current_meta_description: data.metaDescription,
        current_m_title_specs: data.mTitleSpecs,
        tone_references: toneRefs[store],
        // Competitor's own info — keeps unverified fabric keywords out of
        // per-field regenerations too (absent on old saved sessions = old behaviour).
        source_text: data.competitor?.sourceText,
      });
      if (res.error) throw new Error(res.error);
      if (field === "description" && res.description) {
        patch({ description: res.description });
      } else if (field === "meta_description" && res.meta_description) {
        patch({ metaDescription: res.meta_description });
      } else if (field === "m_title_specs" && res.m_title_specs) {
        patch({ mTitleSpecs: res.m_title_specs });
      }
    } catch (e) {
      alert(`Regenerate failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRegenerating((s) => ({ ...s, [field]: false }));
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Generated content
          <span className="text-[11px] font-normal text-text-faint">
            {langFlag} {language}
          </span>
        </span>
      }
    >
      <Field>
        <LabelWithRegenerate
          regenerating={regenerating.description}
          onRegenerate={() => regenerate("description")}
        >
          Description
        </LabelWithRegenerate>
        <Textarea
          rows={12}
          value={data.description}
          onChange={(e) => patch({ description: e.target.value })}
          className="!leading-relaxed"
        />
      </Field>

      <Field>
        <LabelWithRegenerate
          regenerating={regenerating.meta_description}
          onRegenerate={() => regenerate("meta_description")}
        >
          Meta description
        </LabelWithRegenerate>
        <Textarea
          rows={4}
          value={data.metaDescription}
          onChange={(e) => patch({ metaDescription: e.target.value })}
        />
        <div
          className={`text-[11px] mt-1 text-right ${
            metaWarn ? "text-warning" : "text-text-faint"
          }`}
        >
          {metaCount} / 160
        </div>
      </Field>

      <Field>
        <LabelWithRegenerate
          regenerating={regenerating.m_title_specs}
          onRegenerate={() => regenerate("m_title_specs")}
          hint={`— used as: ${data.name || "Name"} | M title specs`}
        >
          M title specs
        </LabelWithRegenerate>
        <Input
          type="text"
          value={data.mTitleSpecs}
          onChange={(e) => patch({ mTitleSpecs: e.target.value })}
        />
        <div className="text-[11px] text-text-faint mt-1.5">
          Example in Google:{" "}
          <span className="text-[#3b5fc0]">
            {data.name || "Name"} | {data.mTitleSpecs || "M title specs"}
          </span>
        </div>
      </Field>
    </Card>
  );
}

/**
 * Label with a small "↻ regenerate this field" button on the right.
 * Falls back to the standard Label when no callback is provided.
 */
function LabelWithRegenerate({
  children,
  hint,
  regenerating,
  onRegenerate,
}: {
  children: React.ReactNode;
  hint?: string;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex items-end justify-between mb-1.5">
      <label className="block">
        <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-text-dim">
          {children}
        </span>
        {hint && (
          <span className="ml-2 text-[11px] font-normal text-text-faint normal-case tracking-normal">
            {hint}
          </span>
        )}
      </label>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenerating}
        title="Regenerate this field with Claude"
        className={[
          "inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase px-2 py-1 rounded-md border transition-colors",
          regenerating
            ? "border-border bg-bg-elev-2 text-text-faint cursor-wait"
            : "border-border bg-bg-elev-2 text-text-dim hover:border-accent hover:text-accent active:scale-95",
        ].join(" ")}
      >
        {regenerating ? <span className="animate-spin inline-block">↻</span> : "↻"}
        {regenerating ? "Regenerating…" : "Regenerate"}
      </button>
    </div>
  );
}
