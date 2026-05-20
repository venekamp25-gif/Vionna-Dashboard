"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { ImageTile } from "@/components/ui/ImageTile";
import { Lightbox } from "@/components/ui/Lightbox";
import { useProduct, colorLabelFor } from "@/lib/product";

export function PublishPoolCard() {
  const { data, patch } = useProduct();
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  const togglePool = (idx: number) => {
    patch({
      publishPool: data.publishPool.map((p, i) =>
        i === idx ? { ...p, selected: !p.selected } : p
      ),
    });
  };

  /**
   * Re-label a pool entry so the chip shows the localised colour for the active tab.
   * E.g. canonical "Sage" → "Salvie" (DK) / "Sauge" (FR).
   * "shared" colour is left as-is.
   */
  const displayLabel = (label: string, canonical: string): string => {
    if (!canonical || canonical === "shared") return label;
    const localised = colorLabelFor(data, canonical, data.activeViewStore);
    if (localised === canonical) return label;
    return label.replace(canonical, localised);
  };

  const selectedCount = data.publishPool.filter((p) => p.selected).length;

  return (
    <Card
      title={
        <span className="flex items-center justify-between gap-2">
          <span>Photos for publication</span>
          {data.publishPool.length > 0 && (
            <span className="text-[11px] font-medium text-text-dim">
              {selectedCount} of {data.publishPool.length} selected
            </span>
          )}
        </span>
      }
    >
      <p className="text-[12px] text-text-dim mb-3">
        Generated photos appear here. Click to check/uncheck. Selected photos (✓) will be sent to Shopify.
        {data.selectedStores.length > 1 && (
          <span className="text-text-faint">
            {" "}Images are shared across all {data.selectedStores.length} stores.
          </span>
        )}
      </p>

      {data.publishPool.length === 0 ? (
        <div className="text-center py-10 px-4 rounded-[10px] bg-bg-elev-2/50 border border-dashed border-border">
          <p className="text-[13px] text-text-faint">
            No photos yet — generate via the Nano Banana workflow above.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {data.publishPool.map((p, i) => (
            <ImageTile
              key={i}
              url={p.url}
              label={displayLabel(p.label, p.color)}
              selected={p.selected}
              onToggle={() => togglePool(i)}
              onZoom={() => setZoomUrl(p.url)}
            />
          ))}
        </div>
      )}

      <Lightbox url={zoomUrl} onClose={() => setZoomUrl(null)} />
    </Card>
  );
}
