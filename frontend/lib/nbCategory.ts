/**
 * Product-type classification for the Nano Banana image steps.
 *
 * ONE vocabulary, used in two places on the frontend:
 *   - NanoBananaSteps.tsx picks the step labels for the category;
 *   - scrape-utils.ts (guessProductType) maps a competitor title to a canonical
 *     English product-type token ("ring", "sunglasses", …).
 * The backend keeps a MIRROR of this list (`_nb_category` / `_nb_accessory_kind`
 * in server.py) — that is what actually selects the prompt set — and
 * backend/tests/test_nb_category.py + tests/nbCategory.test.ts run the same
 * case list against both sides, so they cannot drift apart unnoticed. Change
 * a word here → change it there too.
 *
 * Dependency-free on purpose (no JSX, no "@/" imports): it compiles under
 * tsconfig.test.json and runs on plain node.
 *
 * Matching rules:
 *   - long tokens match as SUBSTRINGS — Danish and Finnish glue compounds
 *     ("skuldertaske", "käsilaukku", "kaulakoru"), so word boundaries would
 *     miss them;
 *   - short / ambiguous tokens match as WHOLE WORDS: "ring" (spring, earring),
 *     "ur" (DK watch), "hat", "cap", "pet" (NL cap), "tas" (NL bag), "belt"
 *     (belted), "watch" (swatch), "kello" (kellohame = FI bell skirt), "sac"…;
 *   - a few garment descriptors that CONTAIN an accessory word are stripped
 *     first ("cap sleeve", "scarf print", "jewel neck", "o-ring", "bootcut",
 *     "baggy") and a few compound BAGS that contain one ("belt bag",
 *     "bæltetaske", "vyölaukku") are settled before the accessory check;
 *   - accessories are checked BEFORE bags: FR "bague" (a ring) contains "bag".
 */

export type NbCategory = "garment" | "shoes" | "bag" | "accessory";

export type AccessoryKind =
  | "jewelry"   // necklace, earrings, generic jewellery words
  | "bracelet"  // wrist in frame
  | "ring"      // hand in frame
  | "eyewear"
  | "headwear"
  | "scarf"
  | "belt"
  | "watch"
  | "gloves"
  | "hair"
  | "other";

// Lower-case Latin letters incl. æ ø å ä ö ü é … (input is lower-cased first).
// JS "\b" is ASCII-only, so /\bvyö\b/ would never match — build the boundary
// by hand. Python's "\b" is Unicode-aware; the backend mirror uses that.
// Includes œ and Latin Extended-A (ā ă ą ć … ž), so "cœur" is not split at the œ.
const L = "a-zà-öø-ÿœĀ-ſ";

interface Vocab {
  /** matched as whole words (regex fragments; may carry their own groups) */
  word?: string[];
  /** matched as substrings */
  sub?: string[];
}

const build = ({ word = [], sub = [] }: Vocab): RegExp => {
  const parts: string[] = [];
  if (word.length) parts.push(`(?:^|[^${L}])(?:${word.join("|")})(?:$|[^${L}])`);
  if (sub.length) parts.push(sub.join("|"));
  return new RegExp(parts.join("|"));
};

/** Garment / shoe descriptors that contain an accessory, bag or shoe word.
 *  Stripped before matching so "cap sleeve dress" stays a dress. Global flag:
 *  only ever used with .replace(), never .test(). */
const NOISE_RE = new RegExp(
  [
    "cap[- ]?sleeves?",              // cap sleeve dress ≠ a cap
    "cap[- ]?toe",                   // cap toe boots ≠ a cap
    "scarf[- ]?print",               // scarf print dress ≠ a scarf
    "jewel[- ]?neck(?:line)?",       // jewel neckline ≠ jewellery
    `(?:^|[^${L}])(?:o|d|double|toe)[- ]rings?`, // o-ring belt, d-ring, toe ring sandals ≠ a ring
    "ring[- ]?(?:details?|handles?|spun|buckles?)", // ring detail dress, ring-spun cotton, ring buckle
    "chain[- ]?(?:details?|straps?)", // chain strap bag ≠ a necklace
    "bootcut",                       // bootcut jeans ≠ boots
    "baggy",                         // baggy jeans ≠ a bag
    "skorts?",                       // skort ≠ sko (DK shoe)
  ].join("|"),
  "g"
);

/** Compound bags that contain an accessory word — settled before the accessory
 *  check so a "belt bag" is a bag, not a belt. */
export const BAG_OVERRIDE_RE = build({
  word: ["belt[- ]?bags?", "bum[- ]?bags?", "fanny[- ]?packs?", "sac[- ]ceinture", "sac[- ]banane"],
  sub: ["bæltetaske", "baeltetaske", "vyölaukku", "vyolaukku", "gürteltasche", "guerteltasche", "heuptas"],
});

const BAG_RE = build({
  // "sac" only as a whole word: it sits inside too many other words.
  word: ["sacs?", "tas(?:je|jes|sen)?"],
  sub: [
    "bag", "handbag", "tote", "shopper", "crossbody", "cross-body", "clutch", "satchel", "purse",
    "backpack", "rucksack", "weekender", "duffel", "pouch", "wallet",
    // DK
    "taske", "håndtaske", "haandtaske", "skuldertaske", "rygsæk", "rygsaek", "pung",
    // FR
    "bandoulière", "bandouliere", "pochette", "cabas", "sacoche", "portefeuille",
    // FI
    "laukku", "käsilaukku", "kasilaukku", "olkalaukku", "reppu", "lompakko",
    // NL
    "handtas", "schoudertas", "rugzak",
  ],
});

const SHOES_RE = build({
  word: ["oxfords", "oxford shoes?"],   // an "oxford shirt" is a shirt
  sub: [
    "shoe", "sneaker", "trainer", "boot", "loafer", "sandal", "heel", "pump", "stiletto",
    "espadrille", "slipper", "flip-flop", "flip flop", "ballet flat", "brogue", "clog", "mule",
    // DK
    "sko", "støvle", "stovle", "hjemmesko", "træsko", "traesko", "hæl", "hael",
    // FR (no "talon": it sits inside "pantalon")
    "chaussure", "basket", "botte", "bottine", "escarpin", "mocassin", "ballerine", "sabot", "chausson",
    // FI
    "keng", "kenk", "lenkkarit", "tennarit", "saappaat", "saapas", "nilkkuri", "sandaalit",
    "korkokeng", "mokkasiini", "tossut", "ballerinat",
    // NL
    "schoen", "laars",
  ],
});

// --- accessories -----------------------------------------------------------
// Kinds are checked in KIND_ORDER below; the order matters where a word sits
// inside another ("armbåndsur" / "armbanduhr" = a watch, not a bracelet;
// "haarschmuck" = hair, not generic jewellery).

const WATCH_RE = build({
  word: ["watch(?:es)?", "ure?", "uhr(?:en)?", "kellot?"],
  sub: ["wristwatch", "smartwatch", "armbåndsur", "armbaandsur", "armbanduhr", "montre", "rannekello", "horloge"],
});

const EYEWEAR_RE = build({
  word: ["bril(?:len)?"],
  sub: [
    "sunglass", "glasses", "eyewear",
    "solbrille", "brille",              // DK briller / DE Brille(n)
    "lunette",                          // FR lunettes (de soleil)
    "aurinkolasi", "silmälasi", "silmalasi",
    "zonnebril", "sonnenbrille",
  ],
});

const HAIR_RE = build({
  word: [
    "hair[- ]?(?:clips?|bands?|ties?|claws?|slides?|pins?|accessor(?:y|ies))",
    "claw[- ]?clips?", "head[- ]?bands?",
    "pinces?[- ]?(?:à|a)?[- ]?cheveux", "pinces?[- ]?crabe", "serre[- ]?t(?:ê|e)te",
  ],
  sub: [
    "scrunchie", "barrette", "chouchou",
    "hårspænde", "haarspaende", "hårbånd", "haarbaand", "hårklemme", "hårelastik",
    "hiuspinni", "hiuspanta", "hiusklipsi", "hiusdonitsi", "hiuskoriste",
    "haarclip", "haarband", "haarspeld", "haarelastiek", "haarspange", "haarreif", "haargummi", "haarschmuck",
  ],
});

const HEADWEAR_RE = build({
  word: ["hats?", "caps?", "huer?", "bonnets?", "hoed(?:en|je)?", "pet(?:je|ten)?", "kasket(?:ter)?", "lippis", "lippalakki"],
  sub: ["beanie", "fedora", "chapeau", "casquette", "béret", "beret", "hattu", "pipo", "mütze", "muetze", "mutze"],
});

const GLOVES_RE = build({
  word: ["gants?", "vanter?"],
  sub: ["glove", "mitten", "handske", "käsine", "kasine", "handschoen", "handschuh", "moufle"],
});

const BELT_RE = build({
  word: ["belts?", "ceintures?", "vyö[tn]?", "riem(?:en)?"],
  sub: ["bælte", "baelte", "gürtel", "guertel", "gurtel"],
});

const SCARF_RE = build({
  word: ["schals?"],
  sub: ["scarf", "scarves", "tørklæde", "toerklaede", "torklaede", "tørklaede", "écharpe", "echarpe", "foulard", "huivi", "sjaal"],
});

const NECKLACE_RE = build({
  sub: ["necklace", "choker", "halskæde", "halskaede", "halskette", "collier", "kaulakoru", "kaulaketju", "ketting"],
});

const EARRINGS_RE = build({
  sub: ["earring", "ørering", "orering", "boucles? d['’]oreilles?", "korvakoru", "oorbel", "ohrring", "ohrstecker"],
});

const BRACELET_RE = build({
  sub: ["bracelet", "bangle", "armbånd", "armbaand", "armband", "rannekoru", "ranneketju"],
});

const RING_RE = build({
  word: ["rings?", "bagues?"],
  // DK/DE/NL compounds ("guldring", "diamantring"); "earring" is caught earlier.
  sub: ["sormus", "sormuks", "guldring", "sølvring", "solvring", "diamantring", "perlering",
        "signetring", "goldring", "silberring", "zegelring"],
});

/** Generic jewellery words — the fallback when no specific piece matched. */
const JEWELLERY_RE = build({
  sub: [
    "jewel", "juwe", "smykke", "bijou", "koru", "sieraad", "sieraden", "schmuck",
    "pendant", "vedhæng", "vedhaeng", "pendentif", "riipus", "brooch", "broche", "anklet",
  ],
});

/** Generic "accessory" words — category accessory, kind unknown. */
const OTHER_RE = build({
  sub: ["accessor", "accessoire", "asuste", "tilbehør", "tilbehoer"],
});

const KIND_ORDER: [AccessoryKind, RegExp[]][] = [
  ["watch",    [WATCH_RE]],
  ["eyewear",  [EYEWEAR_RE]],
  ["hair",     [HAIR_RE]],
  ["headwear", [HEADWEAR_RE]],
  ["gloves",   [GLOVES_RE]],
  ["belt",     [BELT_RE]],
  ["scarf",    [SCARF_RE]],
  // Bracelets and rings get their own framing (wrist / hand), not a chest-up portrait.
  ["bracelet", [BRACELET_RE]],
  ["ring",     [RING_RE]],
  ["jewelry",  [NECKLACE_RE, EARRINGS_RE, JEWELLERY_RE]],
  ["other",    [OTHER_RE]],
];

/** Per-piece regexes for guessProductType (title → canonical token). Built for
 *  LOWER-CASED input; run stripTypeNoise() over the text first. */
export const NB_TYPE_RES = {
  eyewear: EYEWEAR_RE,
  watch: WATCH_RE,
  hair: HAIR_RE,
  necklace: NECKLACE_RE,
  earrings: EARRINGS_RE,
  bracelet: BRACELET_RE,
  ring: RING_RE,
  gloves: GLOVES_RE,
  jewellery: JEWELLERY_RE,
  scarf: SCARF_RE,
  belt: BELT_RE,
  headwear: HEADWEAR_RE,
} as const;

/** Lower-case + strip the garment descriptors that contain an accessory word. */
export const stripTypeNoise = (text: string): string =>
  (text || "").toLowerCase().replace(NOISE_RE, " ");

const kindOf = (pt: string): AccessoryKind | null => {
  for (const [kind, res] of KIND_ORDER) {
    if (res.some((re) => re.test(pt))) return kind;
  }
  return null;
};

/** Category of a free product-type string (EN/DK/FR/FI/NL/DE). */
export function nbCategory(productType: string): NbCategory {
  const pt = stripTypeNoise(productType);
  if (BAG_OVERRIDE_RE.test(pt)) return "bag";
  if (kindOf(pt)) return "accessory";
  if (BAG_RE.test(pt)) return "bag";
  if (SHOES_RE.test(pt)) return "shoes";
  return "garment";
}

/** Which kind of accessory — "other" when it is not one, or an unknown one. */
export function accessoryKind(productType: string): AccessoryKind {
  return kindOf(stripTypeNoise(productType)) ?? "other";
}

export interface NbStep {
  n: number;
  title: string;
  desc: string;
}

/** UI labels only — the backend picks the matching prompt set from the same
 *  product-type string (see _nb_category in server.py), so these just have to
 *  DESCRIBE what each step will produce per category. */
export const STEPS_BY_CATEGORY: Record<NbCategory, readonly NbStep[]> = {
  garment: [
    { n: 1, title: "First model shot",      desc: "Product on model with reference background (4 variants)" },
    { n: 2, title: "Detailed model shot",   desc: "Full face + product details visible" },
    { n: 3, title: "Back view",             desc: "Same model, same background, back view" },
    { n: 4, title: "Close-up material",     desc: "Texture and detail shot of the material" },
  ],
  shoes: [
    { n: 1, title: "First model shot",      desc: "Shoes on model, reference background — shoes are the hero (4 variants)" },
    { n: 2, title: "On-foot detail",        desc: "Knee-down shot, both shoes sharp and prominent" },
    { n: 3, title: "Side profile",          desc: "Silhouette, heel shape and sole line, same model & background" },
    { n: 4, title: "Close-up material",     desc: "Upper material, stitching, sole edge and heel details" },
  ],
  bag: [
    { n: 1, title: "First model shot",      desc: "Model carrying the bag, reference background (4 variants)" },
    { n: 2, title: "Carry detail",          desc: "Bag sharp at chest/hip height, hardware visible" },
    { n: 3, title: "Product shot",          desc: "Bag alone on a styled surface, same setting — no model" },
    { n: 4, title: "Close-up material",     desc: "Material grain, stitching, zips and hardware" },
  ],
  accessory: [
    { n: 1, title: "First model shot",      desc: "Model wearing the accessory, reference background (4 variants)" },
    { n: 2, title: "Detail on model",       desc: "Product prominent and sharp, face visible" },
    { n: 3, title: "Product shot",          desc: "Accessory alone on a styled surface, same setting — no model" },
    { n: 4, title: "Close-up detail",       desc: "Materials: metal, stones, lenses, hardware" },
  ],
};
