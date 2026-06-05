/** English color name → localised Danish / French / Finnish translation. */
export const COLOR_TRANSLATIONS: Record<"dk" | "fr" | "fi", Record<string, string>> = {
  dk: {
    "black": "Sort", "white": "Hvid", "cream": "Creme", "ivory": "Elfenben",
    "beige": "Beige", "red": "Rød", "blue": "Blå", "navy": "Navy", "light blue": "Lyseblå",
    "green": "Grøn", "olive": "Oliven", "sage": "Salvie", "forest green": "Skovgrøn",
    "pink": "Pink", "hot pink": "Hot Pink", "blush": "Blush", "rose": "Rosa",
    "purple": "Lilla", "lilac": "Lilla", "mauve": "Mauve", "violet": "Violet",
    "brown": "Brun", "camel": "Kamel", "tan": "Tan", "chocolate": "Chokolade",
    "grey": "Grå", "gray": "Grå", "light grey": "Lysegrå", "charcoal": "Koks",
    "orange": "Orange", "rust": "Rust", "terracotta": "Terracotta",
    "yellow": "Gul", "mustard": "Sennep", "gold": "Guld", "silver": "Sølv",
    "nude": "Nude", "sand": "Sand", "stone": "Sten", "champagne": "Champagne",
    "mint": "Mint", "teal": "Teal", "burgundy": "Bordeaux", "wine": "Vinrød",
    "leopard": "Leopard", "floral": "Blomstret", "stripe": "Stribet",
  },
  fr: {
    "black": "Noir", "white": "Blanc", "cream": "Crème", "ivory": "Ivoire",
    "beige": "Beige", "red": "Rouge", "blue": "Bleu", "navy": "Marine", "light blue": "Bleu clair",
    "green": "Vert", "olive": "Olive", "sage": "Sauge", "forest green": "Vert forêt",
    "pink": "Rose", "hot pink": "Rose vif", "blush": "Blush", "rose": "Rose",
    "purple": "Violet", "lilac": "Lilas", "mauve": "Mauve", "violet": "Violet",
    "brown": "Marron", "camel": "Camel", "tan": "Fauve", "chocolate": "Chocolat",
    "grey": "Gris", "gray": "Gris", "light grey": "Gris clair", "charcoal": "Anthracite",
    "orange": "Orange", "rust": "Rouille", "terracotta": "Terracotta",
    "yellow": "Jaune", "mustard": "Moutarde", "gold": "Or", "silver": "Argent",
    "nude": "Nude", "sand": "Sable", "stone": "Pierre", "champagne": "Champagne",
    "mint": "Menthe", "teal": "Sarcelle", "burgundy": "Bordeaux", "wine": "Vin",
    "leopard": "Léopard", "floral": "Floral", "stripe": "Rayé",
  },
  fi: {
    "black": "Musta", "white": "Valkoinen", "cream": "Kerma", "ivory": "Norsunluu",
    "beige": "Beige", "red": "Punainen", "blue": "Sininen", "navy": "Laivastonsininen", "light blue": "Vaaleansininen",
    "green": "Vihreä", "olive": "Oliivi", "sage": "Salvianvihreä", "forest green": "Metsänvihreä",
    "pink": "Pinkki", "hot pink": "Pinkki", "blush": "Roosa", "rose": "Roosa",
    "purple": "Violetti", "lilac": "Lila", "mauve": "Malva", "violet": "Violetti",
    "brown": "Ruskea", "camel": "Kamelinruskea", "tan": "Vaaleanruskea", "chocolate": "Suklaa",
    "grey": "Harmaa", "gray": "Harmaa", "light grey": "Vaaleanharmaa", "charcoal": "Antrasiitti",
    "orange": "Oranssi", "rust": "Ruoste", "terracotta": "Terrakotta",
    "yellow": "Keltainen", "mustard": "Sinappi", "gold": "Kulta", "silver": "Hopea",
    "nude": "Nude", "sand": "Hiekka", "stone": "Kivi", "champagne": "Samppanja",
    "mint": "Minttu", "teal": "Petroli", "burgundy": "Viininpunainen", "wine": "Viininpunainen",
    "leopard": "Leopardi", "floral": "Kukkakuvio", "stripe": "Raidallinen",
  },
};

type Store = "dk" | "fr" | "fi";

/** Extra single-word colour words beyond the base table (shades competitors use). */
const EXTRA_COLOR: Record<Store, Record<string, string>> = {
  dk: {
    "cherry": "Kirsebær", "slate": "Skifer", "coral": "Koral", "emerald": "Smaragd",
    "burgundy": "Bordeaux", "apricot": "Abrikos", "peach": "Fersken", "lavender": "Lavendel",
    "khaki": "Kaki", "ecru": "Ecru", "taupe": "Taupe", "plum": "Blomme", "berry": "Bær",
    "espresso": "Espresso", "caramel": "Karamel", "chocolate": "Chokolade", "denim": "Denim",
    "lime": "Lime", "turquoise": "Turkis", "aqua": "Aqua", "magenta": "Magenta",
    "fuchsia": "Fuchsia", "maroon": "Maroon", "sapphire": "Safir", "ice": "Is", "dusty": "Støvet",
    "clay": "Ler", "lemon": "Citrongul", "orchid": "Orkidé", "eucalyptus": "Eukalyptus",
    "indigo": "Indigo", "cobalt": "Koboltblå", "pistachio": "Pistacie", "powder": "Pudder",
    // irregular multi-word shades (matched whole, not via the pattern engine)
    "slate grey": "Skifergrå", "slate gray": "Skifergrå", "off white": "Råhvid",
    "off-white": "Råhvid", "navy blue": "Navy", "dark navy": "Mørk Navy",
    "army green": "Armygrøn", "armygreen": "Armygrøn", "wine red": "Vinrød",
    "rust brown": "Rustbrun", "powder blue": "Pudderblå", "powder pink": "Pudderrosa",
    "mint green": "Mintgrøn", "olive green": "Olivengrøn", "sage green": "Salviegrøn",
  },
  fr: {
    "cherry": "Cerise", "slate": "Ardoise", "coral": "Corail", "emerald": "Émeraude",
    "burgundy": "Bordeaux", "apricot": "Abricot", "peach": "Pêche", "lavender": "Lavande",
    "khaki": "Kaki", "ecru": "Écru", "taupe": "Taupe", "plum": "Prune", "berry": "Baie",
    "espresso": "Espresso", "caramel": "Caramel", "chocolate": "Chocolat", "denim": "Denim",
    "lime": "Citron vert", "turquoise": "Turquoise", "aqua": "Aqua", "magenta": "Magenta",
    "fuchsia": "Fuchsia", "maroon": "Marron", "sapphire": "Saphir", "ice": "Glace", "dusty": "Poudré",
    "clay": "Argile", "lemon": "Citron", "orchid": "Orchidée", "eucalyptus": "Eucalyptus",
    "indigo": "Indigo", "cobalt": "Bleu cobalt", "pistachio": "Pistache", "powder": "Poudre",
    // irregular multi-word shades (matched whole, not via the pattern engine)
    "slate grey": "Gris Ardoise", "slate gray": "Gris Ardoise", "off white": "Blanc cassé",
    "off-white": "Blanc cassé", "navy blue": "Marine", "dark navy": "Marine foncé",
    "army green": "Vert armée", "armygreen": "Vert armée", "wine red": "Rouge bordeaux",
    "rust brown": "Brun rouille", "powder blue": "Bleu poudré", "powder pink": "Rose poudré",
    "mint green": "Vert menthe", "olive green": "Vert olive", "sage green": "Vert sauge",
  },
  fi: {
    "cherry": "Kirsikka", "slate": "Liuske", "coral": "Koralli", "emerald": "Smaragdi",
    "burgundy": "Viininpunainen", "apricot": "Aprikoosi", "peach": "Persikka", "lavender": "Laventeli",
    "khaki": "Khaki", "ecru": "Ecru", "taupe": "Taupe", "plum": "Luumu", "berry": "Marja",
    "espresso": "Espresso", "caramel": "Karamelli", "chocolate": "Suklaa", "denim": "Denim",
    "lime": "Limetti", "turquoise": "Turkoosi", "aqua": "Akva", "magenta": "Magenta",
    "fuchsia": "Fuksia", "maroon": "Kastanjanruskea", "sapphire": "Safiiri", "ice": "Jää", "dusty": "Pölyinen",
    "clay": "Savi", "lemon": "Sitruuna", "orchid": "Orkidea", "eucalyptus": "Eukalyptus",
    "indigo": "Indigo", "cobalt": "Koboltinsininen", "pistachio": "Pistaasi", "powder": "Puuteri",
    // irregular multi-word shades (matched whole, not via the pattern engine)
    "slate grey": "Liuskeenharmaa", "slate gray": "Liuskeenharmaa", "off white": "Luonnonvalkoinen",
    "off-white": "Luonnonvalkoinen", "navy blue": "Laivastonsininen", "dark navy": "Tumma laivastonsininen",
    "army green": "Armeijanvihreä", "armygreen": "Armeijanvihreä", "wine red": "Viininpunainen",
    "rust brown": "Ruosteenruskea", "powder blue": "Puuterinsininen", "powder pink": "Puuterinpinkki",
    "mint green": "Mintunvihreä", "olive green": "Oliivinvihreä", "sage green": "Salvianvihreä",
  },
};

/** Pattern / finish words that follow a colour ("Green Stripe" → "Grøn Stribet"). */
const PATTERN: Record<Store, Record<string, string>> = {
  dk: {
    "stripe": "Stribet", "striped": "Stribet", "stripes": "Stribet",
    "pinstripe": "Nålestribet", "pinstriped": "Nålestribet",
    "polka dot": "Prikket", "polkadot": "Prikket", "polka": "Prikket", "dot": "Prikket", "dots": "Prikket",
    "floral": "Blomstret", "flower": "Blomstret", "flowers": "Blomstret",
    "check": "Ternet", "checked": "Ternet", "checks": "Ternet", "plaid": "Ternet", "gingham": "Ternet",
    "sparkle": "Glimmer", "sparkly": "Glimmer", "glitter": "Glimmer", "shimmer": "Glimmer",
    "metallic": "Metallic", "satin": "Satin", "velvet": "Velour", "lace": "Blonde",
    "leopard": "Leopard", "animal": "Dyreprint", "snake": "Slangeprint", "zebra": "Zebra",
    "tie dye": "Tie-Dye", "ombre": "Ombré", "print": "Print", "printed": "Print",
  },
  fr: {
    "stripe": "Rayé", "striped": "Rayé", "stripes": "Rayé",
    "pinstripe": "Fines Rayures", "pinstriped": "Fines Rayures",
    "polka dot": "à Pois", "polkadot": "à Pois", "polka": "à Pois", "dot": "à Pois", "dots": "à Pois",
    "floral": "Floral", "flower": "Floral", "flowers": "Floral",
    "check": "à Carreaux", "checked": "à Carreaux", "checks": "à Carreaux", "plaid": "à Carreaux", "gingham": "Vichy",
    "sparkle": "Pailleté", "sparkly": "Pailleté", "glitter": "Pailleté", "shimmer": "Pailleté",
    "metallic": "Métallisé", "satin": "Satiné", "velvet": "Velours", "lace": "Dentelle",
    "leopard": "Léopard", "animal": "Imprimé Animal", "snake": "Python", "zebra": "Zèbre",
    "tie dye": "Tie-Dye", "ombre": "Ombré", "print": "Imprimé", "printed": "Imprimé",
  },
  fi: {
    "stripe": "Raidallinen", "striped": "Raidallinen", "stripes": "Raidallinen",
    "pinstripe": "Liituraita", "pinstriped": "Liituraita",
    "polka dot": "Pilkullinen", "polkadot": "Pilkullinen", "polka": "Pilkullinen", "dot": "Pilkullinen", "dots": "Pilkullinen",
    "floral": "Kukkakuvio", "flower": "Kukkakuvio", "flowers": "Kukkakuvio",
    "check": "Ruudullinen", "checked": "Ruudullinen", "checks": "Ruudullinen", "plaid": "Ruudullinen", "gingham": "Ruudullinen",
    "sparkle": "Kimallus", "sparkly": "Kimallus", "glitter": "Kimallus", "shimmer": "Kimallus",
    "metallic": "Metallinen", "satin": "Satiini", "velvet": "Sametti", "lace": "Pitsi",
    "leopard": "Leopardi", "animal": "Eläinkuosi", "snake": "Käärmekuosi", "zebra": "Seepra",
    "tie dye": "Tie-Dye", "ombre": "Liukuväri", "print": "Kuosi", "printed": "Painettu",
  },
};

/** Longest pattern phrases first so "polka dot" matches before "dot". */
const PATTERN_KEYS = (store: Store) =>
  Object.keys(PATTERN[store]).sort((a, b) => b.length - a.length);

const MODIFIERS = new Set(["dark", "light", "deep", "bright", "pale", "soft", "dusty", "muted", "hot", "baby", "royal", "burnt", "ice", "icy"]);

function titleCaseWord(w: string): string {
  if (!w) return w;
  // keep small French connectors lowercase ("à")
  if (w === "à") return w;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Translate a bare colour word (no pattern), handling one optional leading
 *  modifier. Returns null if the colour isn't recognised. */
function translateColorWord(words: string[], store: Store): string | null {
  if (words.length === 0) return null;
  const joined = words.join(" ");
  // Multi-word base colour ("light blue", "forest green", "hot pink", "light grey")
  if (COLOR_TRANSLATIONS[store][joined]) return COLOR_TRANSLATIONS[store][joined];
  if (EXTRA_COLOR[store][joined]) return EXTRA_COLOR[store][joined];

  // Single base colour
  if (words.length === 1) {
    const w = words[0];
    if (COLOR_TRANSLATIONS[store][w]) return COLOR_TRANSLATIONS[store][w];
    if (EXTRA_COLOR[store][w]) return EXTRA_COLOR[store][w];
    return null;
  }

  // modifier + colour ("dark brown", "light pink", "dusty rose")
  if (words.length >= 2 && MODIFIERS.has(words[0])) {
    const mod = words[0];
    const base = translateColorWord(words.slice(1), store);
    if (!base) return null;
    if (store === "dk") {
      // Danish: modifier as compound prefix — Mørkebrun, Lysegrøn, Støvet Rosa
      const PREFIX_DK: Record<string, string> = {
        dark: "Mørke", light: "Lyse", deep: "Dyb", bright: "Klar", pale: "Bleg",
        soft: "Blød", dusty: "Støvet", muted: "Dæmpet", hot: "Hot", baby: "Baby",
        royal: "Royal", burnt: "Brændt", ice: "Is", icy: "Is",
      };
      const p = PREFIX_DK[mod];
      if (!p) return null;
      // dark/light glue onto the colour (Mørkebrun); others stay as two words
      if (mod === "dark" || mod === "light" || mod === "ice" || mod === "icy") {
        return p + base.toLowerCase();
      }
      return `${p} ${base}`;
    } else if (store === "fi") {
      // Finnish: modifier as compound prefix — Tummanruskea, Vaaleansininen
      const PREFIX_FI: Record<string, string> = {
        dark: "Tumman", light: "Vaalean", deep: "Syvän", bright: "Kirkkaan", pale: "Haalean",
        soft: "Pehmeä", dusty: "Pölyinen", muted: "Vaimea", hot: "Kuuma", baby: "Vauvan",
        royal: "Kuninkaallinen", burnt: "Poltettu", ice: "Jää", icy: "Jäinen",
      };
      const p = PREFIX_FI[mod];
      if (!p) return null;
      // dark/light/deep/bright/pale glue onto the colour (Tummanruskea); others stay two words
      if (["dark", "light", "deep", "bright", "pale"].includes(mod)) {
        return p + base.toLowerCase();
      }
      return `${p} ${base}`;
    } else {
      // French: modifier as suffix — Marron foncé, Bleu clair, Rose poudré
      const SUFFIX_FR: Record<string, string> = {
        dark: "foncé", light: "clair", deep: "profond", bright: "vif", pale: "pâle",
        soft: "doux", dusty: "poudré", muted: "atténué", hot: "vif", baby: "bébé",
        royal: "roi", burnt: "brûlé", ice: "glacé", icy: "glacé",
      };
      const s = SUFFIX_FR[mod];
      if (!s) return null;
      return `${base} ${s}`;
    }
  }
  return null;
}

/**
 * Translate an English colour into the store's language.
 *
 * Handles, in order:
 *  1. exact base-table match ("black" → "Sort")
 *  2. exact extra-colour match ("cherry" → "Kirsebær")
 *  3. compound "{colour} {pattern}" ("Green Stripe" → "Grøn Stribet",
 *     "Brown Polka Dot" → "Brun Prikket", "Black Sparkle" → "Sort Glimmer")
 *  4. modifier "{dark/light} {colour}" ("Dark Brown" → "Mørkebrun")
 *  5. fallback: return the original unchanged (never garble an unknown colour).
 */
export function translateColor(color: string, store: Store): string {
  const raw = (color || "").trim();
  if (!raw) return raw;
  const lower = raw.toLowerCase();

  // 1 & 2: exact whole-string match
  if (COLOR_TRANSLATIONS[store][lower]) return COLOR_TRANSLATIONS[store][lower];
  if (EXTRA_COLOR[store][lower]) return EXTRA_COLOR[store][lower];

  // Multi-colour "A/B" (or "A / B") — translate each side independently and
  // rejoin. Only commit if at least one side actually changed.
  if (raw.includes("/")) {
    const parts = raw.split("/").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const tr = parts.map((p) => translateColor(p, store));
      if (tr.some((t, i) => t !== parts[i])) return tr.join("/");
    }
  }

  // Tokens for compound handling
  const tokens = lower.split(/[\s/&-]+/).filter(Boolean);

  // 3: trailing pattern/finish word(s)
  for (const pk of PATTERN_KEYS(store)) {
    const pkTokens = pk.split(" ");
    const n = pkTokens.length;
    if (tokens.length > n && tokens.slice(-n).join(" ") === pk) {
      const colorWords = tokens.slice(0, tokens.length - n);
      const ct = translateColorWord(colorWords, store);
      if (ct) {
        return `${titleCaseWord(ct)} ${PATTERN[store][pk]}`
          .split(" ").map(titleCaseWord).join(" ");
      }
    }
  }

  // 4: modifier + colour (no pattern)
  const modResult = translateColorWord(tokens, store);
  if (modResult) return modResult;

  // 5: give up — keep the original (no regression vs. before)
  return raw;
}
