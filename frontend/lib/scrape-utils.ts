import type { ScrapedProduct } from "./api";

const SIZE_RE = /^(xs|s|m|l|xl|xxl|xxxl|one size|os|\d{1,3}(cm)?)$/i;
const COLOR_OPT_RE = /colou?r|kleur|farve|couleur/i;

/** Extract color list from a scraped product (Shopify .json format). */
export function extractColors(product: ScrapedProduct["product"]): string[] {
  if (!product) return [];

  const isSize = (v: string) => SIZE_RE.test(v.trim());

  // Find an option named like "Color/Colour/Kleur/Farve/Couleur",
  // else any option whose values are NOT all sizes.
  const opts = product.options ?? [];
  const colorOpt =
    opts.find((o) => COLOR_OPT_RE.test(o.name)) ||
    opts.find((o) => o.values?.length && !o.values.every(isSize));

  if (colorOpt?.values?.length && !colorOpt.values.every(isSize)) {
    return colorOpt.values.slice(0, 6);
  }

  // Fallback: derive from handle (skip generic clothing words).
  const handle = product.handle || "";
  const skip = /^(dress|top|skirt|blouse|coat|jacket|shirt|pants|jeans|mini|maxi|midi|womens|women)$/i;
  const last = handle.split("-").filter((w) => w.length > 2 && !skip.test(w)).pop();
  if (last) return [last.charAt(0).toUpperCase() + last.slice(1)];

  return [];
}

const TYPE_MAP: [string, RegExp][] = [
  ["jacket",   /jacket|jas|veste|jakke/i],
  ["coat",     /coat|mantel|manteau/i],
  ["blazer",   /blazer/i],
  ["blouse",   /blouse|top|shirt/i],
  ["skirt",    /skirt|rok|jupe|nederdel/i],
  ["trousers", /trouser|pant|broek|pantalon|bukser/i],
  ["dress",    /dress|jurk|robe|kjole/i],
  ["jumpsuit", /jumpsuit|overall/i],
  ["cardigan", /cardigan|vest/i],
  ["sweater",  /sweater|sweatshirt|pullover|trui|hoodie/i],
];

/** Guess product type (for Nano Banana prompts) from title+handle. */
export function guessProductType(product: ScrapedProduct["product"]): string {
  const text = `${product?.title ?? ""} ${product?.handle ?? ""}`.toLowerCase();
  for (const [type, re] of TYPE_MAP) {
    if (re.test(text)) return type;
  }
  return "dress";  // sensible default for Vionna
}

/** Normalize a Shopify CDN image URL (handles protocol-relative '//...'). */
export function normalizeImageUrl(src: string): string {
  if (src.startsWith("//")) return `https:${src}`;
  return src;
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "competitor.com";
  }
}

/**
 * Map each canonical (title-case English) colour → list of competitor variant IDs.
 * Used downstream so the per-colour ColorRefPicker can filter competitor images to
 * just the ones the competitor tagged for that variant.
 *
 * Matching is case-insensitive on the competitor's `option1/2/3` value (whichever
 * option name looks like a colour). Canonical colours that don't appear in the
 * competitor's option values get an empty list — callers must fall back gracefully.
 */
export function extractVariantsByColor(
  product: ScrapedProduct["product"],
  canonicalColors: string[]
): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const c of canonicalColors) result[c] = [];
  if (!product) return result;

  const opts = product.options ?? [];
  const colorOptIndex = opts.findIndex((o) => COLOR_OPT_RE.test(o.name));
  const optIndex = colorOptIndex >= 0 ? colorOptIndex : 0; // fall back to option1

  const canonicalLower = canonicalColors.map((c) => c.toLowerCase().trim());

  for (const v of product.variants ?? []) {
    if (!v.id) continue;
    const colorValue =
      optIndex === 0 ? v.option1 : optIndex === 1 ? v.option2 : v.option3;
    if (!colorValue) continue;
    const lower = colorValue.toLowerCase().trim();
    const idx = canonicalLower.indexOf(lower);
    if (idx >= 0) result[canonicalColors[idx]].push(v.id);
  }
  return result;
}
