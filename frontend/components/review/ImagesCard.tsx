"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { ImageTile } from "@/components/ui/ImageTile";
import { Lightbox } from "@/components/ui/Lightbox";
import { Field, Label, Input } from "@/components/ui/Field";
import { useProduct } from "@/lib/product";

export function ImagesCard() {
  const { data, patch } = useProduct();
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  const toggleCompetitorImage = (idx: number) => {
    patch({
      competitorImages: data.competitorImages.map((img, i) =>
        i === idx ? { ...img, selected: !img.selected } : img
      ),
    });
  };

  return (
    <Card title="Images">
      <SectionLabel>From competitor</SectionLabel>

      {data.competitorImages.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="aspect-[3/4] rounded-[10px] bg-gradient-to-br from-bg-elev-2 to-bg-elev-3 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6">
          {data.competitorImages.map((img, i) => (
            <ImageTile
              key={i}
              url={img.url}
              label={`Competitor ${i + 1}`}
              selected={img.selected}
              onToggle={() => toggleCompetitorImage(i)}
              onZoom={() => setZoomUrl(img.url)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mt-6 mb-4">
        <span className="flex-1 h-px bg-border" />
        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-accent">
          ✦ Nano Banana — Model photo workflow
        </span>
        <span className="flex-1 h-px bg-border" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3 mb-6 p-4 rounded-[10px] bg-[var(--accent-soft)] border border-accent/20">
        <Field className="!mb-0">
          <Label hint="— our standard off-white studio shot; paste another image URL to override">Background reference URL</Label>
          <div className="flex items-center gap-2">
            {/* A broken reference used to fail silently (four dead CDN links for
                weeks). The thumbnail makes a dead URL visible before generating. */}
            {data.bgReferenceUrl && (
              <img
                src={data.bgReferenceUrl}
                alt=""
                className="w-9 h-12 rounded object-cover border border-border shrink-0 bg-bg-elev-2"
                onError={(e) => {
                  e.currentTarget.style.outline = "2px solid var(--danger)";
                  e.currentTarget.title = "This image cannot be loaded — step 1 will refuse to run with it";
                }}
              />
            )}
            <Input
              type="text"
              value={data.bgReferenceUrl}
              onChange={(e) => patch({ bgReferenceUrl: e.target.value })}
              placeholder="/bg-refs/ref-1.jpg"
              className="flex-1"
            />
          </div>
        </Field>
        <Field className="!mb-0">
          <Label>Product type</Label>
          <Input
            type="text"
            value={data.productType}
            onChange={(e) => patch({ productType: e.target.value })}
            placeholder="dress"
          />
        </Field>
      </div>

      <Lightbox url={zoomUrl} onClose={() => setZoomUrl(null)} />
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-text-faint mb-3 flex items-center gap-2">
      {children}
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}
