"use client";

import { useState, DragEvent } from "react";
import { Card } from "@/components/ui/Card";
import { ImageTile } from "@/components/ui/ImageTile";
import { Lightbox } from "@/components/ui/Lightbox";
import { useProduct, colorLabelFor } from "@/lib/product";

export function PublishPoolCard() {
  const { data, patch } = useProduct();
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

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

  // ── Drag-and-drop reorder ──
  // Order of publishPool is the order images get sent to Shopify (within their
  // colour group). Letting the user reorder = letting them pick which photo
  // becomes the "front" image for each colour variant.
  const onDragStart = (e: DragEvent<HTMLDivElement>, idx: number) => {
    setDraggingIndex(idx);
    e.dataTransfer.effectAllowed = "move";
    // Firefox needs SOMETHING set or the drag won't start
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, idx: number) => {
    if (draggingIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetIndex !== idx) setDropTargetIndex(idx);
  };

  const onDragLeave = () => {
    setDropTargetIndex(null);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === idx) {
      setDraggingIndex(null);
      setDropTargetIndex(null);
      return;
    }
    const next = [...data.publishPool];
    const [moved] = next.splice(draggingIndex, 1);
    next.splice(idx, 0, moved);
    patch({ publishPool: next });
    setDraggingIndex(null);
    setDropTargetIndex(null);
  };

  const onDragEnd = () => {
    setDraggingIndex(null);
    setDropTargetIndex(null);
  };

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
        {data.publishPool.length > 1 && (
          <span className="text-text-faint">
            {" "}Drag tiles to reorder — the order here is the order on Shopify (first photo = main image).
          </span>
        )}
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
          {data.publishPool.map((p, i) => {
            const isDragging = draggingIndex === i;
            const isDropTarget = dropTargetIndex === i && draggingIndex !== i;
            return (
              <div
                key={`${p.url}-${i}`}
                draggable
                onDragStart={(e) => onDragStart(e, i)}
                onDragOver={(e) => onDragOver(e, i)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, i)}
                onDragEnd={onDragEnd}
                className={[
                  "relative transition-all duration-150",
                  // Lift cursor hint so users know it's draggable
                  draggingIndex === null ? "cursor-grab" : "cursor-grabbing",
                  isDragging ? "opacity-40 scale-95" : "opacity-100",
                  isDropTarget
                    ? "ring-2 ring-accent rounded-[12px] shadow-[0_0_0_4px_var(--accent-soft)]"
                    : "",
                ].join(" ")}
              >
                {/* Position badge — shows the current order index, helps the user
                    understand what they're rearranging. */}
                <div className="absolute -top-1.5 -left-1.5 z-10 w-5 h-5 rounded-full bg-bg-elev-2 border border-border text-[10px] font-bold text-text-dim flex items-center justify-center shadow-sm pointer-events-none">
                  {i + 1}
                </div>
                <ImageTile
                  url={p.url}
                  label={displayLabel(p.label, p.color)}
                  selected={p.selected}
                  onToggle={() => togglePool(i)}
                  onZoom={() => setZoomUrl(p.url)}
                />
              </div>
            );
          })}
        </div>
      )}

      <Lightbox url={zoomUrl} onClose={() => setZoomUrl(null)} />
    </Card>
  );
}
