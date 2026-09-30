"use client";

/**
 * "What is this product?" — shown at import only when the competitor's own
 * fields disagree about the type (title says moccasins, product type says
 * trousers — Carina, 30 Sep 2026) and the photos could not settle it (unsure,
 * or the photo check failed). Nothing is researched or written until the
 * operator picks: keywords, copy, sizes and size chart all follow the type.
 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  SOURCE_LABEL,
  type GarmentCategory,
  type TypeCheck,
} from "@/lib/typeCheck";

export function TypeChoiceModal({
  check,
  photos,
  onPick,
  onCancel,
}: {
  check: TypeCheck;
  photos: string[];
  onPick: (category: GarmentCategory) => void;
  onCancel: () => void;
}) {
  const [other, setOther] = useState<GarmentCategory | "">("");
  const named = new Set(check.candidates.map((c) => c.category));

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-xl bg-bg-elev border border-border rounded-2xl shadow-2xl" role="dialog" aria-label="What is this product?">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text">What is this product?</h2>
          <p className="text-[12px] text-text-dim mt-1 leading-relaxed">
            The competitor&apos;s own page disagrees with itself about what it sells
            {check.vision_error ? " and the photo check could not run" : check.vision ? " and the photos did not settle it" : ""}.
            Keywords, copy, sizes and the size chart all follow the type you pick.
          </p>
        </div>

        {photos.length > 0 && (
          <div className="px-6 pt-4 flex gap-2 overflow-x-auto">
            {photos.map((u) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={u} src={`${u}${u.includes("?") ? "&" : "?"}width=240`} alt="" className="h-36 rounded-lg object-cover bg-bg-elev-2" />
            ))}
          </div>
        )}

        <div className="px-6 py-4 space-y-2">
          {check.candidates.map((c) => (
            <button
              key={c.category}
              type="button"
              onClick={() => onPick(c.category)}
              className="w-full text-left px-4 py-3 rounded-xl border border-border hover:border-accent hover:bg-accent/5 transition"
            >
              <div className="text-[13.5px] font-semibold text-text">{CATEGORY_LABEL[c.category]}</div>
              <div className="text-[11.5px] text-text-dim">
                says the competitor&apos;s {c.sources.map((s) => SOURCE_LABEL[s]).join(", ")}
              </div>
            </button>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <select
              value={other}
              onChange={(e) => setOther(e.target.value as GarmentCategory | "")}
              className="flex-1 bg-bg-elev-2 border border-border rounded-lg px-3 py-2 text-[12.5px] text-text"
              aria-label="Something else"
            >
              <option value="">Something else…</option>
              {CATEGORIES.filter((c) => !named.has(c)).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <Button variant="secondary" size="sm" disabled={!other} onClick={() => other && onPick(other)}>
              Use this
            </Button>
          </div>
        </div>

        <div className="flex justify-end px-6 py-3 border-t border-border bg-bg-elev-2 rounded-b-2xl">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Stop the import
          </Button>
        </div>
      </div>
    </div>
  );
}
