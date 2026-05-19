"use client";

import { Card } from "@/components/ui/Card";
import { Field, Label, Input, Textarea } from "@/components/ui/Field";
import { useProduct } from "@/lib/product";
import { useStore, STORE_CONFIG } from "@/lib/store";

export function GeneratedContentCard() {
  const { data, patch } = useProduct();
  const { store } = useStore();
  const langFlag = store === "dk" ? "🇩🇰" : "🇫🇷";
  const language = STORE_CONFIG[store].language;

  const metaCount = data.metaDescription.length;
  const metaWarn  = metaCount > 155;

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
        <Label>Description</Label>
        <Textarea
          rows={12}
          value={data.description}
          onChange={(e) => patch({ description: e.target.value })}
          className="!leading-relaxed"
        />
      </Field>

      <Field>
        <Label>Meta description</Label>
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
        <Label hint={`— used as: ${data.name || "Name"} | M title specs`}>M title specs</Label>
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
