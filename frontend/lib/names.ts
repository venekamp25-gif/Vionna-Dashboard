// Pool of women's names used for product names.
// Each Shopify product is named after one (must be unique in the catalog).
export const WOMEN_NAMES = [
  // Original Scandinavian / Nordic
  "Solène", "Amélie", "Astrid", "Freya", "Ingrid", "Nora", "Sigrid",
  "Elsa", "Maja", "Fiona", "Liora", "Celia", "Thea", "Vera", "Iris",
  "Luna", "Sofia", "Mira", "Zara", "Lena", "Hana", "Aria", "Nina",
  "Tova", "Saga", "Nova",
  // Additional Scandinavian / Nordic
  "Linnea", "Alva", "Liv", "Selma", "Ronja", "Anneli", "Britt", "Greta",
  "Hedda", "Idun", "Karin", "Kira", "Maren", "Mette", "Sanna", "Signe",
  "Sissel", "Stina", "Tilde", "Vilma", "Bodil", "Helga", "Inga", "Jorunn",
  // French
  "Camille", "Chloé", "Margot", "Manon", "Élise", "Léa", "Inès", "Lilou",
  "Anaïs", "Clémence", "Juliette", "Salomé", "Maëlle", "Romane", "Apolline",
  "Sidonie", "Capucine", "Eulalie", "Héloïse",
  // Italian / Mediterranean
  "Giada", "Alessia", "Bianca", "Carla", "Dalia", "Elena", "Flavia",
  "Gaia", "Livia", "Marina", "Noemi", "Ottavia", "Serena", "Tessa",
  // Spanish / Latin
  "Lucia", "Paloma", "Mariana", "Valentina", "Camila", "Bea", "Carmen",
  "Isabella", "Lola", "Pilar",
  // Misc additional
  "Wren", "Indira", "Mila", "Ivy", "Cora", "Lyra", "Esme",
  "Romy", "Daphne", "Calla", "Mariella", "Yara", "Sienna", "Amaya",
];

/**
 * Pick a name that isn't in `exclude`.
 *
 * Tier 1: pick uniformly at random from any unused WOMEN_NAMES entry.
 * Tier 2 (pool exhausted): walk through WOMEN_NAMES and try `name 2`, `name 3`…
 *         in order, returning the first form that's free. This way we never
 *         return a name that's already taken — even when every single name in
 *         the original pool has been published.
 *
 * Older versions had a hardcoded "Nova" fallback which broke the refresh
 * button once Nova itself got published.
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
  return `Vionna ${Date.now()}`;
}
