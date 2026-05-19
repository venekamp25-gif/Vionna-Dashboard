"use client";

import { Card } from "@/components/ui/Card";
import { Field, Label, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useProduct } from "@/lib/product";
import { autoSiblingsHandle } from "@/lib/slug";

const COLOR_DOTS: Record<string, string> = {
  "Blå": "#3b5fc0", "Sort": "#2d2d2d", "Hvid": "#f8f8f8", "Beige": "#f5f0e8",
  "Rød": "#c0392b", "Grøn": "#4a7c5c", "Brun": "#8b6347", "Grå": "#8e8e8e",
  "Navy": "#1e2a4a", "Noir": "#1a1a1a", "Blanc": "#f8f8f8", "Écru": "#f0ead4",
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
        {data.colors.map((color) => (
          <VariantCard
            key={color}
            color={color}
            name={data.name}
            handle={data.siblingsHandle}
          />
        ))}
        {data.colors.length === 0 && (
          <div className="col-span-full text-center text-[12px] text-text-faint py-4">
            Add at least one color above to see variant previews.
          </div>
        )}
      </div>
    </Card>
  );
}

function VariantCard({ color, name, handle }: { color: string; name: string; handle: string }) {
  const dotColor = COLOR_DOTS[color] ?? "#888";
  return (
    <div className="bg-bg-elev-2 border border-border rounded-[10px] p-3 hover:border-border-hover transition-colors">
      <div className="flex items-center gap-2 mb-2.5 font-semibold text-[13px] text-text">
        <span
          className="w-3 h-3 rounded-full border border-border"
          style={{ background: dotColor }}
        />
        Duplicate — {color}
      </div>

      <div className="space-y-2">
        <MiniField label="Product title" value={name} readOnly />
        <MiniField label="Cutline metafield" value={color} readOnly />
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
