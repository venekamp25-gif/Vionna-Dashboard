import type { ScrapedProduct } from "./api";
import { isColorLike } from "./colors";

// Recognise the full Shopify-ish size lexicon so an option like
// ["XXS","XS","S","M","L","XL","XXL","3XL"] is correctly identified as
// SIZES rather than mistaken for colour values (would otherwise cause the
// dashboard to show "Xxs / Xs / S / M / L / Xl" as colour chips).
const SIZE_RE = /^(x{0,5}s|m|l|x{0,5}l|[2-5]xs|[2-5]xl|one\s?size|os|free\s?size|\d{1,3}(cm|mm)?|(uk|us|eu|fr|it)\s?\d{1,2}(\.\d)?)$/i;
const COLOR_OPT_RE = /colou?r|kleur|farve|farbe|färg|couleur|colore|colori|väri|farba/i;
const SIZE_OPT_NAME_RE = /size|maat|taille|størrelse|talla|gr(ö|oe|o|ø)?sse|grootte|storlek|koko|taglia/i;

/** Extract color list from a scraped product (Shopify .json format). */
export function extractColors(product: ScrapedProduct["product"]): string[] {
  if (!product) return [];

  const isSize = (v: string) => SIZE_RE.test(v.trim());
  const isSizeOption = (name: string) => SIZE_OPT_NAME_RE.test(name || "");

  const opts = product.options ?? [];

  // 1. Highest-confidence match: an option whose NAME means "colour" in any
  //    supported language (now incl. German "Farbe", Swedish "Färg", Finnish
  //    "Väri"). Trust the name even if a value or two is exotic.
  const named = opts.find((o) => COLOR_OPT_RE.test(o.name));
  if (named?.values?.length && !named.values.every(isSize)) {
    return named.values.slice(0, 30);
  }

  // 2. No name match: SCORE each non-size option by how many of its values look
  //    like real colours and take the best — but only if a clear majority do.
  //    This is what stops us grabbing an occasion / category option (e.g. a
  //    German "Anlass" → Abend/Sommer, or "Kategorie" → Handtasche/Sonnenbrille)
  //    purely because it isn't a size. A genuine colour option scores ~1.0;
  //    such non-colour options score ~0 and are rejected.
  let best: { values: string[]; score: number } | null = null;
  for (const o of opts) {
    if (isSizeOption(o.name)) continue;
    const vals = (o.values ?? []).filter((v) => v && v.trim());
    if (!vals.length || vals.every(isSize)) continue;
    const score = vals.filter(isColorLike).length / vals.length;
    if (!best || score > best.score) best = { values: vals, score };
  }
  if (best && best.score >= 0.5) {
    // Cap at 30 — bridesmaid vendors routinely have 15-25 colours; the user can
    // trim the chip list in Review. (NB: 30 × stores generations downstream.)
    return best.values.slice(0, 30);
  }

  // 3. Fallback: derive ONE colour from the handle — but ONLY if it actually
  //    looks like a colour. A name-ending handle (`…-calista`) must NOT become
  //    a "Calista" swatch; better to return nothing and let the user set it.
  const handle = product.handle || "";
  const skip = /^(dress|top|skirt|blouse|coat|jacket|shirt|pants|jeans|mini|maxi|midi|womens|women|lace|satin|silk|cotton|linen|long|short|sleeve|sleeveless)$/i;
  const tokens = handle.split("-").filter((w) => w.length > 1 && !skip.test(w));
  if (tokens.length === 0) return [];
  // Two-word colours (`royal-blue`, `dusty-pink`) when the penultimate token is
  // a known modifier; otherwise the single last token.
  const modifier = /^(light|dark|deep|bright|hot|baby|dusty|royal|navy|forest|burnt|rose|ice)$/i;
  const candidate =
    tokens.length >= 2 && modifier.test(tokens[tokens.length - 2])
      ? titleCase(tokens.slice(-2).join(" "))
      : titleCase(tokens[tokens.length - 1]);
  return isColorLike(candidate) ? [candidate] : [];
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

// Order matters: non-apparel (accessory/shoes/swim) and outerwear come BEFORE the
// generic apparel words so a "solbriller" / "handtas" title is recognised instead
// of silently falling through. Multilingual (EN/NL/DA/FR/FI).
const TYPE_MAP: [string, RegExp][] = [
  ["sunglasses", /sunglass|zonnebril|solbrille|lunettes|aurinkolasi/i],
  ["bag",        /handbag|handtas|\btas(je|se)?\b|\bbag\b|\bsac\b|clutch|tote|laukku|purse/i],
  ["jewellery",  /necklace|earring|bracelet|jewel|halsk(æ|ae)de|(ø|o)rering|armb(å|a)nd|collier|boucle|bijoux|koru|smykke/i],
  ["scarf",      /scarf|sjaal|t(ø|o)rkl(æ|ae)de|foulard|huivi/i],
  ["belt",       /\bbelt\b|\briem\b|b(æ|ae)lte|ceinture|vy(ö|o)/i],
  ["hat",        /\bhat\b|\bcap\b|hoed|\bhue\b|chapeau|hattu/i],
  ["shoes",      /shoe|boot|sandal|sneaker|loafer|espadrille|\bmule\b|\bheel|pump|schoen|st(ø|o)vle|\bsko\b|chaussure|kenk|jalkine|saapas/i],
  ["swimsuit",   /swim|bikini|badpak|badedragt|maillot|uimapuku/i],
  ["jacket",   /jacket|jas|veste|jakke/i],
  ["coat",     /coat|mantel|manteau|frakke/i],
  ["blazer",   /blazer/i],
  ["blouse",   /blouse|top|shirt/i],
  ["skirt",    /skirt|rok|jupe|nederdel|hame/i],
  ["trousers", /trouser|pant|broek|pantalon|bukser|housut/i],
  ["dress",    /dress|jurk|robe|kjole|mekko/i],
  ["jumpsuit", /jumpsuit|overall/i],
  ["cardigan", /cardigan|vest/i],
  ["sweater",  /sweater|sweatshirt|pullover|trui|hoodie|strik|neule/i],
];

/**
 * Guess product type (for Nano Banana image prompts) from title+handle.
 *
 * Returns "" when nothing matches — NOT a blind "dress". The old blind default
 * put product_type='dress' on sunglasses ('Daphne') and handbags ('Aline'). The
 * authoritative Shopify product_type is now set at publish from the description-
 * driven LLM category (backend _product_type_for_publish); this title guess is
 * only a hint for image-gen and the editable field, so an empty guess is safer
 * than a wrong one. Image-gen callers already fall back with `|| "dress"`.
 */
export function guessProductType(product: ScrapedProduct["product"]): string {
  const text = `${product?.title ?? ""} ${product?.handle ?? ""}`.toLowerCase();
  for (const [type, re] of TYPE_MAP) {
    if (re.test(text)) return type;
  }
  return "";  // unknown → let the publish-time LLM category decide
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
