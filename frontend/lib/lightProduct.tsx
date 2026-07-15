"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { LightStore } from "@/lib/api";


/** One market's generated copy. `unverifiedClaims` are spec claims (IP rating,
 *  wattage, lumen…) our copy makes that the competitor's page never stated —
 *  warn-only, the operator decides. */
export interface LightContent {
  description: string;
  metaDescription: string;
  mTitleSpecs: string;
  unverifiedClaims: string[];
  sourceSpecs: string[];
}

export const EMPTY_CONTENT: LightContent = {
  description: "",
  metaDescription: "",
  mTitleSpecs: "",
  unverifiedClaims: [],
  sourceSpecs: [],
};

export interface LightImage {
  url: string;
  selected: boolean;
  /** Option value this image belongs to (from the competitor's variant tagging). */
  value?: string;
}

export interface LightDraft {
  competitorUrl: string;
  /** Competitor title + description, plain text. The ONLY source a spec claim may come from. */
  sourceText: string;
  competitorTitle: string;
  productName: string;
  productType: string;
  /** The variant axis exactly as the product has it: Kleur / Color / Design /
   *  light colour. NOT hardcoded to "colour" — the live catalogue uses all four. */
  optionName: string;
  optionValues: string[];
  price: string;
  compareAtPrice: string;
  images: LightImage[];
  imagesByValue: Record<string, string[]>;
  selectedStores: LightStore[];
  content: Partial<Record<LightStore, LightContent>>;
  tags: string[];
  kaching: boolean;
  bundleCollection: string;
  activate: boolean;
}

export const EMPTY_DRAFT: LightDraft = {
  competitorUrl: "",
  sourceText: "",
  competitorTitle: "",
  productName: "",
  productType: "",
  optionName: "",
  optionValues: [],
  price: "",
  compareAtPrice: "",
  images: [],
  imagesByValue: {},
  selectedStores: ["nl"],
  content: {},
  tags: [],
  kaching: true,
  bundleCollection: "",
  activate: false,
};

/** Own storage key — the fashion draft is keyed per user only (server-side
 *  drafts/<email>.json), so sharing it would let whichever portal closed last
 *  overwrite the other's work. */
const LIGHT_DRAFT_KEY = "home_decor_draft_v1";

interface Ctx {
  draft: LightDraft;
  patch: (p: Partial<LightDraft>) => void;
  /** Update ONE market's copy. Must be functional: callers generate several
   *  markets in an await-loop, and a `{...draft.content}` spread built from the
   *  render-time draft would drop every market but the last — silently, since
   *  the only symptom is a publish button that stays greyed out. */
  patchContent: (store: LightStore, p: Partial<LightContent>) => void;
  reset: () => void;
}

const LightProductContext = createContext<Ctx | null>(null);

export function LightProductProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<LightDraft>(EMPTY_DRAFT);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIGHT_DRAFT_KEY);
      if (raw) setDraft({ ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<LightDraft>) });
    } catch {
      /* corrupt draft — start clean rather than crash the portal */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(LIGHT_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* quota / private mode — losing the draft beats breaking the page */
    }
  }, [draft]);

  const patch = (p: Partial<LightDraft>) => setDraft((d) => ({ ...d, ...p }));
  const patchContent = (store: LightStore, p: Partial<LightContent>) =>
    setDraft((d) => ({
      ...d,
      content: { ...d.content, [store]: { ...(d.content[store] ?? EMPTY_CONTENT), ...p } },
    }));
  const reset = () => {
    setDraft(EMPTY_DRAFT);
    try {
      localStorage.removeItem(LIGHT_DRAFT_KEY);
    } catch {
      /* no-op */
    }
  };

  return (
    <LightProductContext.Provider value={{ draft, patch, patchContent, reset }}>
      {children}
    </LightProductContext.Provider>
  );
}

export function useLightProduct(): Ctx {
  const ctx = useContext(LightProductContext);
  if (!ctx) throw new Error("useLightProduct must be used inside LightProductProvider");
  return ctx;
}
