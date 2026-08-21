/** Average sale price per unit = revenue / qty, in whole cents. null when qty <= 0. */
export function avgPerUnitCents(revenueCents: number, qty: number): number | null {
  if (qty <= 0) return null;
  return Math.round(revenueCents / qty);
}
