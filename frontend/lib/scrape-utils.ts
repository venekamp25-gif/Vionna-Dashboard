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

/** Max competitor photos to keep per colour in the ColorRefPicker.
 *  Larger numbers blow up bandwidth (every photo loads on page render) and
 *  bloat the auto-saved draft in localStorage / on the server. 8 is plenty
 *  for picking a colour reference.
 *
 *  Exported because the ColorRefPicker also re-applies the cap at render time —
 *  some users have drafts saved BEFORE the cap was added, and those drafts
 *  contain hundreds of URLs per colour.
 */
export const MAX_IMAGES_PER_COLOR = 8;

/**
 * Group competitor images by canonical colour using a **position-after-anchor**
 * heuristic.
 *
 * Why: Shopify products usually only tag `variant_ids` on the FIRST image of
 * each colour (the variant's `featured_image`). Subsequent shots — back view,
 * details, flat-lay — have empty `variant_ids` even though they visually belong
 * to the same colour. Competitor product pages order their images grouped by
 * colour, so we can walk positions in order and inherit the "current colour"
 * from the most recent tagged image.
 *
 * Example (Marian top, 4 colours × 5 photos each):
 *   pos 1: variant_ids=[Khaki…]      → current = Khaki, push to Khaki
 *   pos 2: variant_ids=[]            → push to Khaki
 *   pos 3-5: same                    → push to Khaki
 *   pos 6: variant_ids=[Light Gray…] → current = Light Gray
 *   pos 7-10: push to Light Gray
 *   … etc.
 *
 * Returns a Record canonical → ordered image URLs. Untagged images that appear
 * before the first anchor (rare) are dropped.
 */
export function groupImagesByColor(
  product: ScrapedProduct["product"],
  canonicalColors: string[]
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const c of canonicalColors) result[c] = [];
  if (!product) return result;

  // Variant ID → canonical colour
  const variantsByColor = extractVariantsByColor(product, canonicalColors);
  const variantToColor: Record<number, string> = {};
  for (const [color, ids] of Object.entries(variantsByColor)) {
    for (const id of ids) variantToColor[id] = color;
  }

  // Sort images by position (fallback to insertion order)
  const images = [...(product.images ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );

  let currentColor: string | null = null;
  for (const img of images) {
    // Switch "current colour" if this image is tagged to one of our colours
    const matched = (img.variant_ids ?? [])
      .map((id) => variantToColor[id])
      .find((c): c is string => !!c);
    if (matched) currentColor = matched;
    if (!currentColor) continue;
    // Cap per-colour to keep page bandwidth + draft-state small.
    if (result[currentColor].length >= MAX_IMAGES_PER_COLOR) continue;
    const url = img.src.startsWith("//") ? `https:${img.src}` : img.src;
    result[currentColor].push(url);
  }
  return result;
}
