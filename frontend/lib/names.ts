// Pool of women's names used for product names.
// Each Shopify product is named after one (must be unique across all
// selected stores' catalogues — see useUsedNames). Curated for an elegant
// fashion-brand vibe: single words, pronounceable in EN/DK/FR, no nicknames.
export const WOMEN_NAMES = [
  // ── Danish / Nordic ──────────────────────────────────────────────
  "Agnete", "Alma", "Alva", "Anneli", "Asta", "Astrid", "Birgitte", "Bodil",
  "Britta", "Cecilie", "Ditte", "Edda", "Elin", "Elsa", "Embla", "Erika",
  "Frida", "Freya", "Greta", "Gro", "Gry", "Hanne", "Hedda", "Helga",
  "Helle", "Henriette", "Hilde", "Ida", "Idun", "Inga", "Ingrid", "Jette",
  "Johanne", "Jorunn", "Karin", "Karoline", "Katrine", "Kira", "Klara",
  "Kristine", "Laila", "Lærke", "Lena", "Linnea", "Liv", "Liva", "Liora",
  "Maja", "Malene", "Maren", "Mathilde", "Mette", "Mille", "Mira", "Nanna",
  "Nora", "Pernille", "Rikke", "Ronja", "Sanna", "Saga", "Selma", "Signe",
  "Sigrid", "Sissel", "Solveig", "Stina", "Susanne", "Thea", "Tilde", "Tova",
  "Trine", "Tuva", "Ulrikke", "Vibeke", "Vilma", "Ylva",

  // ── French ───────────────────────────────────────────────────────
  "Adèle", "Adeline", "Agathe", "Aglaé", "Alice", "Alix", "Aline", "Alizée",
  "Amandine", "Amélie", "Anaïs", "Angèle", "Antoinette", "Apolline", "Aurore",
  "Bérénice", "Blanche", "Brigitte", "Camille", "Capucine", "Cécile", "Céleste",
  "Célestine", "Charlotte", "Chloé", "Clémence", "Clémentine", "Colette",
  "Constance", "Coralie", "Cosette", "Daphné", "Delphine", "Édith", "Eléonore",
  "Élise", "Eulalie", "Fanny", "Florence", "Florine", "Gabrielle", "Gisèle",
  "Héloïse", "Hortense", "Inès", "Isabelle", "Jacqueline", "Jeanne", "Joséphine",
  "Julie", "Juliette", "Justine", "Laurence", "Léa", "Liliane", "Lilou",
  "Louise", "Lucile", "Madeleine", "Maëlle", "Manon", "Margaux", "Margot",
  "Marianne", "Marion", "Maud", "Mélanie", "Mélissa", "Mireille", "Nadine",
  "Noémie", "Océane", "Odette", "Ophélie", "Pauline", "Perrine", "Philippine",
  "Renée", "Romane", "Sabine", "Sandrine", "Salomé", "Séraphine", "Sidonie",
  "Simone", "Solange", "Solène", "Sonia", "Sophie", "Stéphanie", "Sylvie",
  "Thérèse", "Valérie", "Véronique", "Violette", "Virginie", "Yolande",
  "Yvonne", "Zoé",

  // ── English ──────────────────────────────────────────────────────
  "Amelia", "Ariel", "Aurora", "Ava", "Beatrice", "Bella", "Brooke", "Calla",
  "Catherine", "Celia", "Cleo", "Clover", "Cora", "Daisy",
  "Daphne", "Eleanor", "Eliza", "Ella", "Eloise", "Emily", "Emma", "Esme",
  "Estelle", "Eve", "Evelyn", "Faye", "Fern", "Fiona", "Flora", "Gemma",
  "Grace", "Hannah", "Harriet", "Hazel", "Imogen", "Iris", "Isla", "Ivy",
  "Jasmine", "Jenna", "Josie", "Joy", "Juno", "Kate", "Lara", "Lila",
  "Lily", "Lola", "Lottie", "Lyra", "Mabel", "Maeve", "Martha",
  "Matilda", "Maya", "Mia", "Mila", "Millie", "Nell", "Nina", "Olive",
  "Olivia", "Ophelia", "Pearl", "Penelope", "Phoebe", "Piper", "Poppy",
  "Quinn", "Rosa", "Rose", "Ruby", "Ruth", "Sadie", "Sasha",
  "Sophia", "Stella", "Tess", "Tessa", "Valentina", "Victoria", "Violet",
  "Vivian", "Willow", "Wren",

  // ── Additional (Mediterranean / misc but globally readable) ──────
  "Alessia", "Bianca", "Carla", "Elena", "Gaia", "Indira", "Livia", "Lucia",
  "Luna", "Mariana", "Marina", "Noemi", "Nova", "Paloma", "Romy", "Serena",
  "Sienna", "Yara", "Zara",
];

/**
 * Pick a name that isn't in `exclude`.
 *
 * Tier 1: pick uniformly at random from any unused WOMEN_NAMES entry.
 * Tier 2 (pool exhausted): walk WOMEN_NAMES starting at a random offset and
 *         try `name 2`, `name 3` … until one is free. So even with hundreds
 *         of published products we never hand back a name that's already
 *         taken.
 *
 * Older versions had a hardcoded "Nova" fallback which silently broke the
 * refresh button once Nova itself got published.
 */
export function randomName(exclude: string[] = []): string {
  const lower = new Set(exclude.map((n) => n.toLowerCase()));
  // Tier 1
  const pool = WOMEN_NAMES.filter((n) => !lower.has(n.toLowerCase()));
  if (pool.length > 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // Tier 2 — start from a random index so we don't always hand out "Solène 2"
  const start = Math.floor(Math.random() * WOMEN_NAMES.length);
  for (let i = 0; i < WOMEN_NAMES.length; i++) {
    const base = WOMEN_NAMES[(start + i) % WOMEN_NAMES.length];
    for (let suffix = 2; suffix <= 99; suffix++) {
      const candidate = `${base} ${suffix}`;
      if (!lower.has(candidate.toLowerCase())) return candidate;
    }
  }
  // Should be unreachable for any realistic catalogue size
  return `Fashion ${Date.now()}`;
}
