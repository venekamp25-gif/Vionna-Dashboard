"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Field, Label, Input } from "@/components/ui/Field";
import { useProduct, StoreContent } from "@/lib/product";
import { StoreKey, STORE_CONFIG } from "@/lib/store";
import { randomName } from "@/lib/names";
import { slugify } from "@/lib/slug";
import { useUsedNames } from "@/lib/useUsedNames";

const COLOR_DOTS: Record<string, string> = {
  // English canonical keys
  "Black": "#2d2d2d", "White": "#f8f8f8", "Cream": "#f5f0e0", "Ivory": "#f8efd9",
  "Beige": "#f5f0e8", "Red": "#c0392b", "Blue": "#3b5fc0", "Navy": "#1e2a4a",
  "Light Blue": "#8dbce0", "Green": "#4a7c5c", "Olive": "#7d7c4f", "Sage": "#9caa90",
  "Forest Green": "#2e4634", "Pink": "#e8a4b8", "Hot Pink": "#e8409a", "Blush": "#e8c4c4",
  "Rose": "#d88a8a", "Purple": "#7a4ea8", "Lilac": "#bca0d8", "Mauve": "#a68aa6",
  "Violet": "#7a4ea8", "Brown": "#8b6347", "Camel": "#b68559", "Tan": "#c9a880",
  "Chocolate": "#3e2723", "Grey": "#8e8e8e", "Gray": "#8e8e8e", "Light Grey": "#c9c9c9",
  "Charcoal": "#383838", "Orange": "#e07b3c", "Rust": "#a04a2a", "Terracotta": "#c4674a",
  "Yellow": "#e8c84a", "Mustard": "#bca044", "Gold": "#c8a14a", "Silver": "#bababa",
  "Nude": "#d9b89c", "Sand": "#d8c9a6", "Stone": "#a6a098", "Champagne": "#e8d8b4",
  "Mint": "#a6d8c4", "Teal": "#3e8a8c", "Burgundy": "#6e1f2f", "Wine": "#5a1f2f",
  // Legacy localised keys (kept as fallback)
  "Blå": "#3b5fc0", "Sort": "#2d2d2d", "Hvid": "#f8f8f8", "Rød": "#c0392b",
  "Grøn": "#4a7c5c", "Brun": "#8b6347", "Grå": "#8e8e8e", "Noir": "#1a1a1a",
  "Blanc": "#f8f8f8", "Écru": "#f0ead4",
};

type NameStatus = "idle" | "checking" | "available" | "taken";

export function ProductInfoCard() {
  const { data, patch, setData } = useProduct();
  // Note: `useStore.store` follows the active tab. We intentionally do NOT use it
  // for name validation — that has to span every selected store.

  // Shared cache of "already used" product names across all selected stores
  const { byStore: usedNamesByStore, loading: usedNamesLoading } = useUsedNames();
  const selectedStoresKey = data.selectedStores.join(",");

  // ── Name-availability check (debounced 600ms; flags ANY store that owns the name) ──
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const [takenInStores, setTakenInStores] = useState<StoreKey[]>([]);
  useEffect(() => {
    if (!data.name.trim()) { setNameStatus("idle"); setTakenInStores([]); return; }
    if (usedNamesLoading) { setNameStatus("checking"); return; }
    setNameStatus("checking");
    const t = setTimeout(() => {
      const lower = data.name.toLowerCase();
      const offending: StoreKey[] = [];
      for (const s of data.selectedStores) {
        if ((usedNamesByStore[s] ?? []).some((n) => n.toLowerCase() === lower)) {
          offending.push(s);
        }
      }
      setTakenInStores(offending);
      setNameStatus(offending.length > 0 ? "taken" : "available");
    }, 400);
    return () => clearTimeout(t);
  }, [data.name, usedNamesByStore, usedNamesLoading, selectedStoresKey, data.selectedStores]);

  // ── Name-sync (debounced 600ms): replace old name everywhere ACROSS ALL STORES ──
  const lastSyncedName = useRef<string | null>(null);
  useEffect(() => {
    if (lastSyncedName.current === null) {
      lastSyncedName.current = data.name;
      return;
    }
    if (lastSyncedName.current === data.name) return;

    const t = setTimeout(() => {
      const oldName = lastSyncedName.current ?? "";
      const newName = data.name;
      if (!oldName || oldName === newName) {
        lastSyncedName.current = newName;
        return;
      }

      const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nameRe = new RegExp(`\\b${escape(oldName)}\\b`, "gi");

      const oldSlug = slugify(oldName);
      const newSlug = slugify(newName);
      const handleRe = oldSlug ? new RegExp(`^${escape(oldSlug)}(?=-|$)`, "i") : null;

      setData((prev) => {
        // Apply name replacement across every store's content
        const updatedContent = { ...prev.contentByStore };
        (Object.keys(updatedContent) as StoreKey[]).forEach((s) => {
          const c = updatedContent[s];
          updatedContent[s] = {
            ...c,
            description: c.description.replace(nameRe, newName),
            metaDescription: c.metaDescription.replace(nameRe, newName),
            mTitleSpecs: c.mTitleSpecs.replace(nameRe, newName),
          };
        });
        return {
          ...prev,
          contentByStore: updatedContent,
          // Mirror the active view's updated content into the top-level fields
          description: prev.description.replace(nameRe, newName),
          metaDescription: prev.metaDescription.replace(nameRe, newName),
          mTitleSpecs: prev.mTitleSpecs.replace(nameRe, newName),
          siblingsHandle:
            handleRe && handleRe.test(prev.siblingsHandle)
              ? prev.siblingsHandle.replace(handleRe, newSlug)
              : prev.siblingsHandle,
        };
      });

      lastSyncedName.current = newName;
    }, 600);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.name]);

  const refreshName = () => {
    // Avoid any name taken in any selected store. Add the current name too so
    // we don't get the same one back. Try up to 5 picks to dodge the (extremely
    // unlikely) case that randomName returns the same name twice running.
    const taken = new Set<string>();
    for (const s of data.selectedStores) {
      for (const n of usedNamesByStore[s] ?? []) taken.add(n);
    }
    const current = data.name;
    if (current) taken.add(current);

    let newName = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomName(Array.from(taken));
      if (candidate && candidate !== current) {
        newName = candidate;
        break;
      }
      // If randomName handed back the same name (only possible at tier-2
      // fallback edge cases) add this attempt to the exclude list and try again.
      if (candidate) taken.add(candidate);
    }

    if (typeof window !== "undefined" && (window as Window & { __VIONNA_DEBUG?: boolean }).__VIONNA_DEBUG) {
      // Set window.__VIONNA_DEBUG = true in DevTools to opt in to verbose logs.
      // eslint-disable-next-line no-console
      console.log("[refreshName]", {
        current,
        excludedCount: taken.size,
        firstFew: Array.from(taken).slice(0, 8),
        picked: newName,
      });
    }

    if (newName && newName !== current) {
      patch({ name: newName });
    }
  };

  /** Remove a colour by INDEX so we can clean up both canonical key + every store's label. */
  const removeColorAt = (index: number) => {
    setData((prev) => {
      const canonical = prev.canonicalColors[index];
      if (!canonical) return prev;

      const newCanonical = prev.canonicalColors.filter((_, i) => i !== index);
      const newColors = prev.colors.filter((_, i) => i !== index);

      // Drop this canonical key from every store's colorLabels + recompute cutline
      const newContent: Record<StoreKey, StoreContent> = { ...prev.contentByStore };
      (Object.keys(newContent) as StoreKey[]).forEach((s) => {
        const labels = { ...newContent[s].colorLabels };
        delete labels[canonical];
        newContent[s] = {
          ...newContent[s],
          colorLabels: labels,
          cutline: newCanonical.map((c) => labels[c] ?? c).join(", "),
        };
      });

      // Drop image state keyed by this canonical colour
      const newNbResultsPerColor = { ...prev.nbResultsPerColor };
      delete newNbResultsPerColor[canonical];
      const newColorRefs = { ...prev.colorRefsByColor };
      delete newColorRefs[canonical];

      return {
        ...prev,
        canonicalColors: newCanonical,
        colors: newColors,
        contentByStore: newContent,
        cutline: newContent[prev.activeViewStore]?.cutline ?? "",
        nbResultsPerColor: newNbResultsPerColor,
        colorRefsByColor: newColorRefs,
        publishPool: prev.publishPool.filter((p) => p.color !== canonical),
      };
    });
  };

  return (
    <Card title="Product info">
      <Field>
        <Label hint="(female name, unique)">Product name</Label>
        <div className="flex gap-2">
          <Input
            type="text"
            value={data.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="flex-1"
          />
          <button
            type="button"
            title="Generate new name"
            onClick={refreshName}
            className="w-10 h-10 flex items-center justify-center rounded-[10px] bg-bg-elev-2 border border-border text-text-dim hover:border-accent hover:text-accent transition active:scale-95"
          >
            ↻
          </button>
        </div>
        <NameStatusLine status={nameStatus} takenInStores={takenInStores} />
      </Field>

      <Field>
        <Label>Colors (from competitor)</Label>
        <div className="flex flex-wrap gap-2">
          {data.canonicalColors.map((canonical, i) => {
            const display = data.colors[i] ?? canonical;
            return (
              <Chip
                key={canonical}
                variant="color"
                color={COLOR_DOTS[canonical] ?? COLOR_DOTS[display] ?? "#999"}
                onRemove={() => removeColorAt(i)}
              >
                {display}
              </Chip>
            );
          })}
          {data.canonicalColors.length === 0 && (
            <span className="text-[12px] text-text-faint">No colors detected</span>
          )}
        </div>
      </Field>

      <Field>
        <Label>Sizes</Label>
        <div className="flex flex-wrap gap-2">
          {data.sizes.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </div>
      </Field>

      <Field>
        <Label>Price</Label>
        <div className="flex gap-2 items-center">
          <Input
            type="text"
            value={data.price}
            onChange={(e) => patch({ price: e.target.value })}
            className="!w-[140px] flex-none"
          />
          <select
            value={data.discount}
            onChange={(e) => patch({ discount: Number(e.target.value) as 0 | 25 | 50 })}
            className="flex-1 h-10 px-3 rounded-[10px] bg-bg-elev-2 border border-border text-[13px] cursor-pointer hover:border-border-hover focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-soft)]"
          >
            <option value={0}>No discount</option>
            <option value={25}>~25% discount</option>
            <option value={50}>~50% discount</option>
          </select>
        </div>
      </Field>

      <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-text-faint mt-6 mb-3 flex items-center gap-2">
        Metafields
        <span className="flex-1 h-px bg-border" />
      </div>

      <Field>
        <Label hint="(auto from colors)">Cutline</Label>
        <Input
          type="text"
          value={data.cutline}
          onChange={(e) => patch({ cutline: e.target.value })}
        />
      </Field>

      <Field>
        <Label>Siblings collection handle</Label>
        <Input
          type="text"
          value={data.siblingsHandle}
          onChange={(e) => patch({ siblingsHandle: e.target.value })}
          placeholder="e.g. solene-collection"
        />
      </Field>

      <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-text-faint mt-6 mb-3 flex items-center gap-2">
        Found keywords
        <span className="flex-1 h-px bg-border" />
      </div>
      <div className="flex flex-wrap gap-2">
        {data.parsedKeywords.map((k, i) => (
          <Chip key={i} variant="keyword">
            {k}
          </Chip>
        ))}
        {data.parsedKeywords.length === 0 && (
          <span className="text-[12px] text-text-faint">No keywords entered</span>
        )}
      </div>
    </Card>
  );
}

function NameStatusLine({
  status,
  takenInStores,
}: {
  status: NameStatus;
  takenInStores: StoreKey[];
}) {
  if (status === "idle") return <div className="h-[14px]" />;
  if (status === "checking") {
    return <div className="text-[11px] text-text-faint mt-1">Checking catalogue…</div>;
  }
  if (status === "taken") {
    const labels = takenInStores.map(
      (s) => STORE_CONFIG[s].label.replace("Store ", "")
    );
    const where = labels.length === 0 ? "your store" : labels.join(" + ");
    return (
      <div className="text-[11px] text-danger mt-1 flex items-center gap-1">
        ⚠ Already used in {where}
      </div>
    );
  }
  return (
    <div className="text-[11px] text-accent mt-1 flex items-center gap-1">
      ✓ Available in {takenInStores.length === 0 ? "all selected stores" : "selected stores"}
    </div>
  );
}
