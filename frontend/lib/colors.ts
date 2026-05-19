/** English color name → localised Danish / French translation. */
export const COLOR_TRANSLATIONS: Record<"dk" | "fr", Record<string, string>> = {
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
};

export function translateColor(color: string, store: "dk" | "fr"): string {
  const lower = color.toLowerCase().trim();
  return COLOR_TRANSLATIONS[store][lower] ?? color;
}
