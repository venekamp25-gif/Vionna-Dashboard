/**
 * Compute the "compare at" (original) price from a sale price + discount %.
 * Rounds the compare-at up to the nearest 10. Returns "499.00" style string or null.
 *
 * Example: price="349,00 DKK", discount=25 → 465.33 → 470.00 → "470.00"
 */
export function calcComparePrice(priceStr: string, discountPct: number): string | null {
  const p = parseFloat(priceStr.replace(/,/g, ".").replace(/[^\d.]/g, ""));
  if (!p || !discountPct) return null;
  const raw = p / (1 - discountPct / 100);
  return (Math.ceil(raw / 10) * 10).toFixed(2);
}
