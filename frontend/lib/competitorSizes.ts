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

// 0XL/1XL: the plus-size scale some shops use (0XL, 1XL, 2XL…) — kept as they
// are: 1XL is not XL, merging them loses a size (review, 30 Sep).
export const LISTING_LETTERS = ["3XS", "XXS", "XS", "S", "M", "L", "XL", "0XL", "1XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL"];
export const DEFAULT_SIZES = ["XS", "S", "M", "L", "XL"];
export const SHOE_FALLBACK = ["36", "37", "38", "39", "40", "41"];

/** Option names that mean "size" in the shops we copy from (35 spellings seen). */
export const SIZE_OPT_NAME_RE =
  /size|taille|pointure|st[øoö]r{1,2}e?ls?e|storlek|koko|gr(ö|oe|o|ø)?(ss|ß)e|\bmaat|\bmaten\b|grootte|talla|taglia|tamanho|rozmiar|\bstr\b/i;
const NOT_SIZE_OPT_RE = /forst[øo]rrelse|length|l[æa]ngde|longueur|pituus|hauteur|inseam|antal|quantit|pack|model/i;
const COLOUR_OPT_RE = /colou?r|kleur|farve|farbe|färg|couleur|colore|colori|väri|farba/i;
const SHOE_OPT_RE = /pointure|sko|shoe|chaussure|kenk|schuh|schoen/i;

const LETTER_ALIASES: Record<string, string> = {
  XXL: "2XL", XXXL: "3XL", XXXXL: "4XL", XXXXXL: "5XL", "2XS": "XXS", XXXS: "3XS",
  SMALL: "S", MEDIUM: "M", LARGE: "L", XSMALL: "XS", XLARGE: "XL", "X-SMALL": "XS", "X-LARGE": "XL",
  "XX-LARGE": "2XL", XXLARGE: "2XL", "XX-SMALL": "XXS",
  LILLE: "S", STOR: "L", EKSTRASTOR: "XL", // DK
};
/** Values that name the option, not a size. */
const PLACEHOLDER_RE = /^(taille|size|koko|størrelse|maat|personnalisée|custom|sur mesure)$/i;
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
  /** what "↺ Competitor sizes" brings back — [] when the competitor sells none */
  restore: string[];
  restoreSource: SizeSource | null;
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
  if (PLACEHOLDER_RE.test(v)) return null;
  if (ONE_SIZE_RE.test(v)) return "One Size";
  // combined letters: "S/M", "M / L", "XS-S", goddiva "SM"/"ML"
  const comb = v.toUpperCase().replace(/\s+/g, "").match(/^([0-9]?X{0,4}[SML])[/\-–]([0-9]?X{0,4}[SML])$/);
  if (comb) {
    const a = letter(comb[1]);
    const b = letter(comb[2]);
    if (a && b) return `${a}/${b}`;
  }
  if (/^(SM|ML)$/i.test(v)) return v.toUpperCase() === "SM" ? "S/M" : "M/L";
  // a letter with something next to it: keep the LETTER ("S (36)", "M (EU 38)",
  // "XS/6", "S(US 6-8)", "XS 32/34", "M - 38", "M | 38", "36 (S)", "29 - XXS").
  // In a list of EU numbers the list decides (see competitorSizes).
  const withNum =
    v.match(/^([0-9]?X{0,4}[SML]|X{1,4}L|\dXL|\dXS)(?=\s*[(/|:\-–]|\s+\S)/i) ??
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
  // a two-number range is one size (socks, tights: "36-38", "41/45")
  const range = v.match(/^(\d{2})\s*[-/–]\s*(\d{2})$/);
  if (range && +range[1] < +range[2]) return `${range[1]}-${range[2]}`;
  // bare small numbers (UK/AU dress or UK/AU shoe sizes) are decided per LIST
  if (isUkNumber(v)) return v;
  return null;
}

/** The EU number written next to a letter ("Lady S (46)", "M (EU 38)", "XS 32/34" → 32). */
function attachedNumber(raw: string): string | null {
  const v = String(raw ?? "").replace(STOCK_TEXT_RE, "").replace(/^lady\s+/i, "").trim();
  const m = v.match(/^(?:[0-9]?X{0,4}[SML]|X{1,4}L|\dXL|\dXS)\s*[(/|\-–:]?\s*(?:EUR?\s*)?(\d{2})\b/i);
  return m ? m[1] : null;
}

/** UK/AU dress sizes → letters (venek 30 Sep: convert, show it). AU = UK. */
const UK_DRESS: Record<string, string> = {
  "4": "XXS", "6": "XS", "8": "S", "10": "M", "12": "L", "14": "XL", "16": "2XL", "18": "3XL", "20": "4XL", "22": "5XL",
  "24": "6XL", "26": "7XL",
};
/** UK shoe sizes → EU. */
const UK_SHOE: Record<string, string> = { "2": "35", "3": "36", "4": "37", "5": "38", "6": "39", "7": "40", "8": "41", "9": "42", "10": "43" };
/** AU (= US) women's shoe sizes → EU (Billy J's own size guide: AU 5 = EU 36 … AU 10 = EU 41). */
const AU_SHOE: Record<string, string> = { "5": "36", "6": "37", "7": "38", "8": "39", "9": "40", "10": "41" };

/** Whose size system are bare numbers in? The same "8" is a UK S, a US M and
 *  an AU shoe 38 — so only a UK or AU shop (or a label that says so) converts. */
export function sizeRegion(host: string, optionName: string, raw: string[]): "uk" | "au" | "us" | null {
  const h = (host || "").toLowerCase().replace(/\.$/, "");
  const said = `${optionName} ${raw.join(" ")}`;
  if (/\bUK\b/i.test(said) || /\.(co\.)?uk$/.test(h)) return "uk";
  if (/\bAU\b/i.test(said) || /\.(com\.)?au$/.test(h)) return "au";
  if (/\bUS\b/i.test(said)) return "us";
  return null;
}

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

const isLetterSize = (s: string) => s.split("/").every((p) => LISTING_LETTERS.includes(p));
const isEuNumber = (s: string) => /^\d{2,3}(\.5)?$/.test(s);
const joinNotes = (...n: (string | undefined)[]) => n.filter(Boolean).join(". ") || undefined;

/**
 * The sizes a new listing starts with. `category` is the listing's type
 * category ("shoes", "accessory", "bag", garments…); `host` the competitor's
 * domain (decides whether bare numbers are UK, AU or unknown).
 *
 * `restore` is what "↺ Competitor sizes" may bring back: only sizes the
 * competitor really sells — never a fallback we made up (review, 30 Sep).
 */
export function competitorSizes(options: OptionLike[] | undefined, category: string, host = ""): CompetitorSizes {
  const cat = (category || "").toLowerCase();
  if (cat === "accessory" || cat === "bag") {
    // Accessories are One Size (venek, 16 Jul). But the category here is a
    // guess from the title — a "combinaison à ceinture" reads as a belt — so
    // when the competitor sells real sizes, say so and keep them restorable.
    const asGarment = competitorSizes(options, "garment", host);
    const sold = (asGarment.source === "competitor" || asGarment.source === "converted-uk") &&
      asGarment.sizes.length >= 2;
    return {
      sizes: ["One Size"],
      source: "one-size",
      raw: asGarment.raw,
      note: sold
        ? `Listed as One Size because it reads as an accessory, but the competitor sells sizes (${asGarment.sizes.join(" ")}) — if it is clothing, use "↺ Competitor sizes"`
        : undefined,
      restore: sold ? asGarment.sizes : [],
      restoreSource: sold ? asGarment.source : null,
    };
  }
  const opt = findSizeOption(options);
  const raw = (opt?.values ?? []).map(String);
  const isShoe = cat === "shoes" || SHOE_OPT_RE.test(opt?.name ?? "");
  const pairs = raw.map((v) => ({ v, n: normCompetitorSize(v) }));
  let norm = [...new Set(pairs.map((p) => p.n).filter((x): x is string => !!x))];
  const dropped = pairs.filter((p) => !p.n && !PLACEHOLDER_RE.test(p.v.trim())).map((p) => p.v.trim());
  const droppedNote = dropped.length ? `Not read at the competitor: ${dropped.slice(0, 5).join(", ")}` : undefined;
  const fallback = (why: string): CompetitorSizes =>
    isShoe
      ? { sizes: SHOE_FALLBACK, source: "shoe-default", raw, note: `${why} — shoes default to EU 36–41, check the sizes`, restore: [], restoreSource: null }
      : { sizes: DEFAULT_SIZES, source: "default", raw, note: `${why} — XS–XL used, check the sizes`, restore: [], restoreSource: null };
  const found = (sizes: string[], source: SizeSource, note?: string): CompetitorSizes => ({
    sizes, source, raw, note: joinNotes(note, droppedNote), restore: sizes, restoreSource: source,
  });
  if (!opt) return fallback("The competitor lists no sizes");
  if (!norm.length) return fallback("The competitor's sizes couldn't be read");
  // EU numbers with a few letters that carry their own number ("32 … 44, Lady S (46)"):
  // the letter is the competitor's label, the number is the size.
  if (norm.some(isEuNumber) && norm.some(isLetterSize)) {
    const renorm = pairs.filter((p) => p.n).map((p) => (isLetterSize(p.n!) ? attachedNumber(p.v) : p.n));
    if (renorm.every((x): x is string => !!x && isEuNumber(x))) norm = [...new Set(renorm as string[])];
    else return fallback("The competitor mixes letter and number sizes");
  }
  const bare = norm.filter(isUkNumber);
  if (bare.length) {
    if (bare.length !== norm.length || dropped.length) return fallback("The competitor mixes size systems");
    const region = sizeRegion(host, opt.name ?? "", raw);
    if (isShoe) {
      const table = region === "uk" ? UK_SHOE : region === "au" || region === "us" ? AU_SHOE : null;
      if (!table) return fallback("Bare shoe numbers — UK, US or AU sizes? Not converted");
      const eu = bare.map((s) => table[s]);
      return eu.every(Boolean)
        ? found(sortListingSizes([...new Set(eu)]), "converted-uk", `Converted from ${region!.toUpperCase()} shoe sizes to EU`)
        : fallback("Unusual shoe sizes at the competitor");
    }
    if (region !== "uk" && region !== "au") {
      return fallback(`Bare numbers (${bare.slice(0, 4).join(", ")}…) — UK or US dress sizes? Not converted`);
    }
    const letters = bare.map((s) => UK_DRESS[s]);
    return letters.every(Boolean)
      ? found(sortListingSizes([...new Set(letters)]), "converted-uk", "Converted from UK/AU dress sizes (6 = XS, 8 = S, 10 = M…)")
      : fallback("The competitor uses numeric sizes that can't be converted (jeans?)");
  }
  const sizes = sortListingSizes(norm).slice(0, 30);
  if (isShoe && sizes.every(isLetterSize)) {
    // real shoes are sold in EU numbers; letters mean slippers — or a garment
    // the title guess took for a shoe (Carina). Keep what the competitor sells.
    return found(sizes, "competitor", "Clothing sizes on a product listed as shoes — check the type and the sizes");
  }
  return found(sizes, "competitor", sizes.length === 1 && sizes[0] !== "One Size" ? "The competitor sells only one size" : undefined);
}
