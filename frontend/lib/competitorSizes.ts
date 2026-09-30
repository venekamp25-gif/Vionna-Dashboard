/**
 * Competitor sizes → the listing's sizes (v1.323).
 *
 * Until now every listing got a hard-coded XS–XL and the competitor's size
 * option was thrown away. Measured 30 Sep 2026 on 9,406 products of 42
 * competitor stores: only 13% of their letter lists are exactly XS–XL, 35%
 * reach 3XL+, 69% have no XS; shoes come in EU 35–43; some UK/AU shops use
 * dress sizes 6–18. venek decided: take the competitor's sizes, XS–XL only as
 * a fallback, UK/AU dress sizes converted to letters, and let the operator edit.
 *
 * Pure (no React, no DOM) so node tests can run it. The backend normalises
 * again at publish (server.py `_listing_sizes`); keep both in step.
 */

export const LISTING_LETTERS = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL"];
export const DEFAULT_SIZES = ["XS", "S", "M", "L", "XL"];
export const SHOE_FALLBACK = ["36", "37", "38", "39", "40", "41"];

/** Option names that mean "size" in the shops we copy from (35 spellings seen). */
export const SIZE_OPT_NAME_RE =
  /size|taille|pointure|st[øoö]r{1,2}e?ls?e|storlek|koko|gr(ö|oe|o|ø)?(ss|ß)e|\bmaat|\bmaten\b|grootte|talla|taglia|tamanho|rozmiar|\bstr\b/i;
const NOT_SIZE_OPT_RE = /forst[øo]rrelse|length|l[æa]ngde|longueur|pituus|hauteur|inseam|antal|quantit|pack|model/i;
const COLOUR_OPT_RE = /colou?r|kleur|farve|farbe|färg|couleur|colore|colori|väri|farba/i;
const SHOE_OPT_RE = /pointure|sko|shoe|chaussure|kenk|schuh|schoen/i;

const LETTER_ALIASES: Record<string, string> = {
  XXL: "2XL", XXXL: "3XL", XXXXL: "4XL", XXXXXL: "5XL", "2XS": "XXS", XXXS: "XXS", "1XL": "XL",
  SMALL: "S", MEDIUM: "M", LARGE: "L", XSMALL: "XS", XLARGE: "XL", "X-SMALL": "XS", "X-LARGE": "XL",
  "XX-LARGE": "2XL", XXLARGE: "2XL", "XX-SMALL": "XXS",
};
const ONE_SIZE_RE =
  /^(one[\s-]?size(\s+fits\s+all)?|onesize|os|osfa|o\/s|tu|t\.u\.?|free[\s-]?size|taille[\s-]?unique|unique|yksi[\s-]?koko|einheitsgr(ö|oe)(ss|ß)e|str\.?\s*one\s*size)$/i;
const STOCK_TEXT_RE =
  /\s*[-–(]?\s*(\(?\s*(presque|quasi)\s+épuisé\)?|\(?\s*\d+\s+en\s+stock\)?|udsolgt|sold\s*out|loppu(unmyyty)?|épuisé|restock|ny|new)\)?\s*$/i;

export type SizeSource = "competitor" | "converted-uk" | "one-size" | "default" | "shoe-default" | "manual";

export interface CompetitorSizes {
  sizes: string[];
  source: SizeSource;
  /** the competitor's own values, untouched (for the "↺ competitor sizes" chip + history) */
  raw: string[];
  /** a sentence for the operator when something was converted or assumed */
  note?: string;
}

/** UK/AU dress sizes run 4–22 and UK shoe sizes 2–10; EU sizes start at ~32. */
function isUkNumber(s: string): boolean {
  return /^\d{1,2}$/.test(s) && parseInt(s, 10) <= 26;
}

function letter(v: string): string | null {
  const u = v.toUpperCase().replace(/\s+/g, "");
  const a = LETTER_ALIASES[u] ?? u;
  return LISTING_LETTERS.includes(a) ? a : null;
}

/** One competitor value → the listing spelling, or null when it isn't a size
 *  we can publish (bra sizes, W/L pairs, cm, phone models, sentences). */
export function normCompetitorSize(raw: string): string | null {
  let v = String(raw ?? "").replace(/\s+/g, " ").trim();
  v = v.replace(STOCK_TEXT_RE, "").replace(/^lady\s+/i, "").replace(/['’;:.,!]+$/, "").trim();
  // multi-system FIRST — "UK 2 | EU 35" is 5 words but a perfectly good size:
  // take the EU number ("(UK) 3/ (EU) 36", "36 EUR / 38 FR")
  const eu = v.match(/\bEUR?\)?\s*:?\s*(\d{2}(?:[.,]5)?)\b|\b(\d{2}(?:[.,]5)?)\s*\(?EUR?\b/i);
  if (eu && v.length <= 32 && /(UK|US|FR|IT|AU|\||\/)/i.test(v)) return String(parseFloat((eu[1] ?? eu[2]).replace(",", ".")));
  if (!v || v.length > 24 || v.split(" ").length > 4) return null;
  if (/^(taille|size|koko|størrelse|maat|personnalisée|custom|sur mesure)$/i.test(v)) return null;
  if (ONE_SIZE_RE.test(v)) return "One Size";
  // combined letters: "S/M", "M / L", "XS-S", goddiva "SM"/"ML"
  const comb = v.toUpperCase().replace(/\s+/g, "").match(/^([0-9]?X{0,4}[SML])[/\-–]([0-9]?X{0,4}[SML])$/);
  if (comb) {
    const a = letter(comb[1]);
    const b = letter(comb[2]);
    if (a && b) return `${a}/${b}`;
  }
  if (/^(SM|ML)$/i.test(v)) return v.toUpperCase() === "SM" ? "S/M" : "M/L";
  // letter with a number next to it: keep the LETTER ("S (36)", "M (EU 38)", "XS/6", "36 (S)", "29 - XXS")
  const withNum =
    v.match(/^([0-9]?X{0,4}[SML]|X{1,4}L|\dXL|\dXS)\s*[(/]\s*(EU\s*)?\d/i) ??
    v.match(/^\d{1,2}(?:[/-]\d{1,2})?\s*[(-]\s*([0-9]?X{0,4}[SML]|\dXL)\)?$/i);
  if (withNum) {
    const l = letter(withNum[1]);
    if (l) return l;
  }
  const l = letter(v);
  if (l) return l;
  // EU number ("EU 38", "38 EU", "36.0", "40,5", "37½")
  const n = v.replace(/½/, ".5").match(/^(?:EUR?\s*)?(\d{2}(?:[.,](?:0|5))?)(?:\s*EUR?)?$/i);
  if (n) return String(parseFloat(n[1].replace(",", ".")));
  // bare small numbers (UK/AU dress or UK shoe sizes) are decided per LIST
  if (isUkNumber(v)) return v;
  return null;
}

/** UK/AU dress sizes → letters (venek 30 Sep: convert, show it). */
const UK_DRESS: Record<string, string> = {
  "4": "XXS", "6": "XS", "8": "S", "10": "M", "12": "L", "14": "XL", "16": "2XL", "18": "3XL", "20": "4XL", "22": "5XL",
};
/** UK shoe sizes → EU. */
const UK_SHOE: Record<string, string> = { "2": "35", "3": "36", "4": "37", "5": "38", "6": "39", "7": "40", "8": "41", "9": "42", "10": "43" };

export function sortListingSizes(sizes: string[]): string[] {
  const idx = (s: string) => LISTING_LETTERS.indexOf(s.split("/")[0]);
  if (sizes.every((s) => idx(s) >= 0)) return [...sizes].sort((a, b) => idx(a) - idx(b) || a.length - b.length);
  if (sizes.every((s) => /^\d{2,3}(\.5)?$/.test(s))) return [...sizes].sort((a, b) => parseFloat(a) - parseFloat(b));
  return sizes;
}

interface OptionLike {
  name?: string;
  values?: string[];
}

/** Which option carries the sizes (by name first, then by its values). */
export function findSizeOption(options: OptionLike[] | undefined): OptionLike | null {
  const opts = (options ?? []).filter(
    (o) => (o.values ?? []).length && !(/^(title|titel)$/i.test(o.name ?? "") && (o.values ?? []).length === 1)
  );
  const byName = opts.filter((o) => SIZE_OPT_NAME_RE.test(o.name ?? "") && !NOT_SIZE_OPT_RE.test(o.name ?? ""));
  if (byName.length) {
    return byName.sort((a, b) => sizeShare(b.values ?? []) - sizeShare(a.values ?? []))[0];
  }
  // a colour-named option holding only sizes (vienoonni "Väri" = S–2XL)
  const colourSizes = opts.find((o) => COLOUR_OPT_RE.test(o.name ?? "") && sizeShare(o.values ?? [], true) === 1);
  if (colourSizes) return colourSizes;
  return (
    opts.find(
      (o) =>
        !COLOUR_OPT_RE.test(o.name ?? "") &&
        !/style|type|produit|model|variant|antal|quantit|pack/i.test(o.name ?? "") &&
        sizeShare(o.values ?? [], true) >= 0.8
    ) ?? null
  );
}

function sizeShare(values: string[], strict = false): number {
  if (!values.length) return 0;
  const ok = values.filter((v) => {
    const n = normCompetitorSize(v);
    if (!n) return false;
    return strict ? !isUkNumber(n) : true; // plain 1–10 isn't proof of a size option
  }).length;
  return ok / values.length;
}

/**
 * The sizes a new listing starts with. `category` is the listing's type
 * category ("shoes", "accessory", "bag", garments…).
 */
export function competitorSizes(options: OptionLike[] | undefined, category: string): CompetitorSizes {
  const cat = (category || "").toLowerCase();
  if (cat === "accessory" || cat === "bag") {
    const opt = findSizeOption(options);
    return { sizes: ["One Size"], source: "one-size", raw: opt?.values ?? [] };
  }
  const opt = findSizeOption(options);
  const raw = (opt?.values ?? []).map(String);
  const isShoe = cat === "shoes" || SHOE_OPT_RE.test(opt?.name ?? "");
  const norm = [...new Set(raw.map(normCompetitorSize).filter((x): x is string => !!x))];
  const fallback = (why: string): CompetitorSizes =>
    isShoe
      ? { sizes: SHOE_FALLBACK, source: "shoe-default", raw, note: `${why} — shoes default to EU 36–41, check the sizes` }
      : { sizes: DEFAULT_SIZES, source: "default", raw, note: `${why} — XS–XL used, check the sizes` };
  if (!opt) return fallback("The competitor lists no sizes");
  if (!norm.length) return fallback("The competitor's sizes couldn't be read");
  const bare = norm.filter(isUkNumber);
  if (bare.length) {
    if (bare.length !== norm.length) return fallback("The competitor mixes size systems");
    if (isShoe) {
      const eu = bare.map((s) => UK_SHOE[s]);
      return eu.every(Boolean)
        ? { sizes: sortListingSizes([...new Set(eu)]), source: "converted-uk", raw, note: "Converted from UK shoe sizes to EU" }
        : fallback("Unusual shoe sizes at the competitor");
    }
    const letters = bare.map((s) => UK_DRESS[s]);
    return letters.every(Boolean)
      ? { sizes: sortListingSizes([...new Set(letters)]), source: "converted-uk", raw, note: "Converted from UK/AU dress sizes (6 = XS, 8 = S, 10 = M…)" }
      : fallback("The competitor uses numeric sizes that can't be converted (jeans?)");
  }
  if (isShoe && norm.every((s) => LISTING_LETTERS.includes(s.split("/")[0]))) {
    return fallback("Shoes listed in clothing sizes at the competitor");
  }
  const sizes = sortListingSizes(norm).slice(0, 30);
  return {
    sizes,
    source: "competitor",
    raw,
    note: sizes.length === 1 && sizes[0] !== "One Size" ? "The competitor sells only one size" : undefined,
  };
}
