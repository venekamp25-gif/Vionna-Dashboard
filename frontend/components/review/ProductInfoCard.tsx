"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Field, Label, Input } from "@/components/ui/Field";
import { useProduct } from "@/lib/product";
import { useStore } from "@/lib/store";
import { randomName } from "@/lib/names";
import { slugify } from "@/lib/slug";
import { api } from "@/lib/api";

const COLOR_DOTS: Record<string, string> = {
  "Blå": "#3b5fc0", "Sort": "#2d2d2d", "Hvid": "#f8f8f8", "Beige": "#f5f0e8",
  "Rød": "#c0392b", "Grøn": "#4a7c5c", "Brun": "#8b6347", "Grå": "#8e8e8e",
  "Navy": "#1e2a4a", "Noir": "#1a1a1a", "Blanc": "#f8f8f8", "Écru": "#f0ead4",
};

type NameStatus = "idle" | "checking" | "available" | "taken";

export function ProductInfoCard() {
  const { data, patch } = useProduct();
  const { store } = useStore();

  // ── Used names cache (fetched once per Review session) ──
  const [usedNames, setUsedNames] = useState<string[]>([]);
  const [usedNamesLoading, setUsedNamesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .names(store)
      .then((r) => { if (!cancelled) setUsedNames(r.names ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setUsedNamesLoading(false); });
    return () => { cancelled = true; };
  }, [store]);

  // ── Name-availability check (debounced 600ms) ──
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  useEffect(() => {
    if (!data.name.trim()) { setNameStatus("idle"); return; }
    if (usedNamesLoading) { setNameStatus("checking"); return; }
    setNameStatus("checking");
    const t = setTimeout(() => {
      const taken = usedNames.some((n) => n.toLowerCase() === data.name.toLowerCase());
      setNameStatus(taken ? "taken" : "available");
    }, 400);
    return () => clearTimeout(t);
  }, [data.name, usedNames, usedNamesLoading]);

  // ── Name-sync (debounced 600ms): replace old name everywhere ──
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

      patch({
        description:     data.description.replace(nameRe, newName),
        metaDescription: data.metaDescription.replace(nameRe, newName),
        mTitleSpecs:     data.mTitleSpecs.replace(nameRe, newName),
        siblingsHandle:
          handleRe && handleRe.test(data.siblingsHandle)
            ? data.siblingsHandle.replace(handleRe, newSlug)
            : data.siblingsHandle,
      });

      lastSyncedName.current = newName;
    }, 600);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.name]);

  const refreshName = () => {
    const newName = randomName([...usedNames, data.name]);
    patch({ name: newName });
  };

  const removeColor = (c: string) =>
    patch({ colors: data.colors.filter((x) => x !== c) });

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
        <NameStatusLine status={nameStatus} />
      </Field>

      <Field>
        <Label>Colors (from competitor)</Label>
        <div className="flex flex-wrap gap-2">
          {data.colors.map((c) => (
            <Chip
              key={c}
              variant="color"
              color={COLOR_DOTS[c] ?? "#999"}
              onRemove={() => removeColor(c)}
            >
              {c}
            </Chip>
          ))}
          {data.colors.length === 0 && (
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

function NameStatusLine({ status }: { status: NameStatus }) {
  if (status === "idle") return <div className="h-[14px]" />;
  if (status === "checking") {
    return <div className="text-[11px] text-text-faint mt-1">Checking catalogue…</div>;
  }
  if (status === "taken") {
    return (
      <div className="text-[11px] text-danger mt-1 flex items-center gap-1">
        ⚠ This name is already used in your store
      </div>
    );
  }
  return (
    <div className="text-[11px] text-accent mt-1 flex items-center gap-1">
      ✓ Available
    </div>
  );
}
