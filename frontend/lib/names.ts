// Pool of women's names used for product names.
// Each Shopify product is named after one (must be unique in the catalog).
export const WOMEN_NAMES = [
  "Solène", "Amélie", "Astrid", "Freya", "Ingrid", "Nora", "Sigrid",
  "Elsa", "Maja", "Fiona", "Liora", "Celia", "Thea", "Vera", "Iris",
  "Luna", "Sofia", "Mira", "Zara", "Lena", "Hana", "Aria", "Nina",
  "Tova", "Saga",
];

export function randomName(exclude: string[] = []): string {
  const lower = new Set(exclude.map((n) => n.toLowerCase()));
  const pool = WOMEN_NAMES.filter((n) => !lower.has(n.toLowerCase()));
  if (pool.length === 0) return "Nova";
  return pool[Math.floor(Math.random() * pool.length)];
}
