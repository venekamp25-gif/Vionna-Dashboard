"use client";

import { Card } from "@/components/ui/Card";
import { Field, Label, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useProduct } from "@/lib/product";
import { autoSiblingsHandle } from "@/lib/slug";

const COLOR_DOTS: Record<string, string> = {
  // English canonical keys
  "Black": "#2d2d2d", "White": "#f8f8f8", "Cream": "#f5f0e0", "Ivory": "#f8efd9",
  "Beige": "#f5f0e8", "Red": "#c0392b", "Blue": "#3b5fc0", "Navy": "#1e2a4a",
  "Light Blue": "#8dbce0", "Green": "#4a7c5c", "Olive": "#7d7c4f", "Sage": "#9caa90",
  "Forest Green": "#2e4634", "Pink": "#e8a4b8", "Hot Pink": "#e8409a", "Blush": "#e8c4c4",
  "Rose": "#d88a8a", "Purple": "#7a4ea8", "Lilac": "#bca0d8", "Mauve": "#a68aa6",
  "Brown": "#8b6347", "Camel": "#b68559", "Tan": "#c9a880", "Chocolate": "#3e2723",
  "Grey": "#8e8e8e", "Gray": "#8e8e8e", "Light Grey": "#c9c9c9", "Charcoal": "#383838",
  "Orange": "#e07b3c", "Rust": "#a04a2a", "Terracotta": "#c4674a",
  "Yellow": "#e8c84a", "Mustard": "#bca044", "Gold": "#c8a14a", "Silver": "#bababa",
  "Nude": "#d9b89c", "Sand": "#d8c9a6", "Stone": "#a6a098", "Champagne": "#e8d8b4",
  "Mint": "#a6d8c4", "Teal": "#3e8a8c", "Burgundy": "#6e1f2f", "Wine": "#5a1f2f",
  // Localised fallback (DK / FR)
  "Sort": "#2d2d2d", "Hvid": "#f8f8f8", "Blå": "#3b5fc0", "Rød": "#c0392b",
  "Grøn": "#4a7c5c", "Brun": "#8b6347", "Grå": "#8e8e8e",
  "Noir": "#1a1a1a", "Blanc": "#f8f8f8", "Écru": "#f0ead4",
};

export function ColorVariantsCard() {
  const { data, patch } = useProduct();

  const setAutoHandle = () => {
    patch({ siblingsHandle: autoSiblingsHandle(data.name) });
  };

  return (
    <Card title="Color variants & Siblings collection">
      <p className="text-[13px] text-text-dim mb-4 leading-relaxed">
        On publish, a <strong className="text-text">Shopify collection is automatically created</strong> and per color
        a <strong className="text-text">duplicate product</strong> with the correct metafields — so they appear as
        swatches in the Pipeline theme.
      </p>

      <div className="flex gap-2 items-end mb-4">
        <Field className="flex-1 !mb-0">
          <Label hint="(will be created in Shopify)">Collection handle</Label>
          <Input
            type="text"
            value={data.siblingsHandle}
            onChange={(e) => patch({ siblingsHandle: e.target.value })}
            placeholder={`${data.name ? data.name.toLowerCase() : "solene"}-siblings`}
          />
          {data.siblingsHandle && (
            <div className="text-[11px] text-text-faint mt-1">
              Collection name in Shopify: <span className="text-text-dim">&quot;{prettyCollectionName(data.siblingsHandle)}&quot;</span>
            </div>
          )}
        </Field>
        <Button variant="secondary" size="md" onClick={setAutoHandle}>
          Auto ↻
        </Button>
      </div>

      <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-accent/8 border border-accent/30 text-[12px] text-text-dim mb-4 leading-relaxed">
        <span className="text-accent text-base leading-none mt-0.5">ℹ</span>
        <span>
          Each color variant gets its own product page in Shopify.{" "}
          <strong className="text-text">Cutline</strong> = the color of that duplicate.{" "}
          <strong className="text-text">Siblings handle</strong> = the collection that groups them as swatches.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.canonicalColors.map((canonical, i) => {
          const displayLabel = data.colors[i] ?? canonical;
          return (
            <VariantCard
              key={canonical}
              displayLabel={displayLabel}
              canonical={canonical}
              name={data.name}
              handle={data.siblingsHandle}
            />
          );
        })}
        {data.canonicalColors.length === 0 && (
          <div className="col-span-full text-center text-[12px] text-text-faint py-4">
            Add at least one color above to see variant previews.
          </div>
        )}
      </div>
    </Card>
  );
}

function VariantCard({
  displayLabel,
  canonical,
  name,
  handle,
}: {
  displayLabel: string;
  canonical: string;
  name: string;
  handle: string;
}) {
  const dotColor = COLOR_DOTS[canonical] ?? COLOR_DOTS[displayLabel] ?? "#888";
  return (
    <div className="bg-bg-elev-2 border border-border rounded-[10px] p-3 hover:border-border-hover transition-colors">
      <div className="flex items-center gap-2 mb-2.5 font-semibold text-[13px] text-text">
        <span
          className="w-3 h-3 rounded-full border border-border"
          style={{ background: dotColor }}
        />
        Duplicate — {displayLabel}
      </div>

      <div className="space-y-2">
        <MiniField label="Product title" value={name} readOnly />
        <MiniField label="Cutline metafield" value={displayLabel} readOnly />
        <MiniField label="Siblings handle" value={handle || "—"} readOnly />
      </div>

      <div className="mt-2.5 px-2.5 py-1.5 rounded-md bg-bg-elev text-[11px] text-text-faint flex items-center gap-1.5">
        <span>⟳</span>
        Will be created on publish
      </div>
    </div>
  );
}

function MiniField({ label, value, readOnly }: { label: string; value: string; readOnly?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-text-faint tracking-wider uppercase mb-0.5">{label}</div>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        className="w-full bg-bg-elev border border-border rounded-md px-2.5 py-1.5 text-[12px] text-text disabled:opacity-60 cursor-default"
      />
    </div>
  );
}

function prettyCollectionName(handle: string): string {
  // e.g. freya-siblings → "Freya Siblings"
  return handle
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
