/**
 * Import type check (v1.324) — what IS this product?
 *
 * Carina, 30 Sep 2026: the competitor page's title and description said
 * moccasins, but its own product type ("Dress Pants Women"), tags, XS–XL sizes
 * and photos said trousers. The import took the title and 24 listings went live
 * as shoes. The backend (/api/resolve_type) compares the competitor's own
 * fields and, when they disagree, lets the photos decide; this file holds the
 * pure helpers the import step uses around it.
 *
 * Pure (no React, no "@/" imports) so node tests can run it.
 */

export type GarmentCategory =
  | "dress" | "top" | "skirt" | "pants" | "knitwear" | "outerwear" | "shoes" | "swim" | "accessory";
export type TypeSource = "title" | "product_type" | "tags" | "description" | "sizes" | "photos";

export interface TypeCheck {
  category: GarmentCategory | null;
  /** text: the competitor's fields agree · photos: they disagreed, the photos
   *  decided · operator: picked by hand · unknown: nothing named a type ·
   *  unchecked: the check itself could not run (server busy) */
  decided_by: "text" | "photos" | "operator" | "unknown" | "unchecked";
  conflict: boolean;
  signals: Partial<Record<TypeSource, string | null>>;
  /** competitor fields that described ANOTHER product — kept away from keywords and copy */
  misleading: TypeSource[];
  vision: { category: GarmentCategory; item: string; confidence: "high" | "medium" | "low"; evidence: string } | null;
  vision_error: string | null;
  candidates: { category: GarmentCategory; sources: TypeSource[] }[];
  /** the product-type word for image steps and Shopify ("trousers", "coat") */
  product_type: string;
}

export const CATEGORIES: GarmentCategory[] = [
  "dress", "top", "skirt", "pants", "knitwear", "outerwear", "shoes", "swim", "accessory",
];

export const CATEGORY_LABEL: Record<GarmentCategory, string> = {
  dress: "Dress / jumpsuit",
  top: "Top / blouse / shirt",
  skirt: "Skirt / shorts",
  pants: "Trousers / jeans",
  knitwear: "Knitwear",
  outerwear: "Jacket / coat",
  shoes: "Shoes",
  swim: "Swimwear",
  accessory: "Accessory",
};

/** canonical product-type word per category — same table as the backend's _CAT_TYPE_TOKEN */
export const CATEGORY_TOKEN: Record<GarmentCategory, string> = {
  dress: "dress", top: "blouse", skirt: "skirt", pants: "trousers", knitwear: "sweater",
  outerwear: "jacket", shoes: "shoes", swim: "swimsuit", accessory: "accessory",
};

export const SOURCE_LABEL: Record<TypeSource, string> = {
  title: "title",
  product_type: "product type",
  tags: "tags",
  description: "description",
  sizes: "sizes",
  photos: "photos",
};

interface ProductLike {
  title?: string;
  body_html?: string;
  product_type?: string;
  tags?: string | string[];
  images?: { src: string }[];
}

const abs = (u: string) => (u.startsWith("//") ? `https:${u}` : u);

/**
 * 2–4 photos for the check: the first photo, then the first photo of up to
 * three OTHER colours — the item that changes colour between them is the
 * product; what stays the same is styling.
 */
export function typeCheckPhotos(product: ProductLike | undefined, imagesByColor: Record<string, string[]>): string[] {
  const out: string[] = [];
  const add = (u?: string) => {
    if (u && !out.includes(abs(u))) out.push(abs(u));
  };
  add(product?.images?.[0]?.src);
  for (const urls of Object.values(imagesByColor)) {
    if (out.length >= 4) break;
    add(urls[0]);
  }
  for (const img of product?.images ?? []) {
    if (out.length >= 2) break;
    add(img.src);
  }
  return out.slice(0, 4);
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tagText = (t: string | string[] | undefined) => (Array.isArray(t) ? t.join(", ") : t ?? "");

/**
 * The competitor text keywords and copy may lean on: the fields the check did
 * NOT flag. When title and description both described another product, only
 * the competitor's own product type and tags are left.
 */
export function trustedSourceText(product: ProductLike | undefined, misleading: TypeSource[]): string {
  const parts: string[] = [];
  if (!misleading.includes("title")) parts.push(product?.title ?? "");
  if (!misleading.includes("description")) parts.push(plain(product?.body_html ?? ""));
  if (!parts.some((p) => p.trim())) {
    if (!misleading.includes("product_type")) parts.push(product?.product_type ?? "");
    if (!misleading.includes("tags")) parts.push(tagText(product?.tags));
  }
  return parts.join(" ").trim().slice(0, 4000);
}

/** After the operator picks: every competitor field that named another type. */
export function misleadingFor(tc: Pick<TypeCheck, "signals">, category: GarmentCategory): TypeSource[] {
  return (["title", "product_type", "tags", "description"] as TypeSource[]).filter((s) => {
    const v = tc.signals[s];
    return !!v && v !== category;
  });
}

/** The product-type word after an operator pick — the title's own word when it fits. */
export function tokenFor(category: GarmentCategory, guess: string, guessCategory: string): string {
  return guess && guessCategory === category ? guess : CATEGORY_TOKEN[category];
}

/** One sentence for Review when the check changed or could not settle the type. */
export function describeTypeCheck(tc: TypeCheck | null): string | null {
  if (!tc || !tc.category) {
    return tc?.decided_by === "unchecked"
      ? "The product type could not be checked against the competitor's own fields (the check did not answer) — make sure the type is right."
      : null;
  }
  const label = CATEGORY_LABEL[tc.category];
  const wrong = tc.misleading.map((s) => SOURCE_LABEL[s]);
  const backed = (["product_type", "tags", "sizes"] as TypeSource[])
    .filter((s) => (s === "sizes" ? (tc.signals.sizes === "alpha" || tc.signals.sizes === "even") && tc.category !== "shoes" : tc.signals[s] === tc.category))
    .map((s) => SOURCE_LABEL[s]);
  if (tc.decided_by === "photos" && !tc.conflict) {
    return `Listed as ${label} — the competitor's page names no product type, the photos show ${label.toLowerCase()}.`;
  }
  if (tc.decided_by === "photos") {
    const said = wrong.length ? `The competitor's ${wrong.join(" and ")} describe${wrong.length === 1 ? "s" : ""} another product` : "The competitor's own fields disagreed";
    return `Listed as ${label}. ${said}, but ${[...backed, "photos"].join(", ")} show ${label.toLowerCase()} — keywords, copy, sizes and size chart were made for ${label.toLowerCase()}.`;
  }
  if (tc.decided_by === "operator") {
    return `Listed as ${label} (your choice — the competitor's own fields disagreed${wrong.length ? `; its ${wrong.join(" and ")} named another type` : ""}).`;
  }
  return null;
}
