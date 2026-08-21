export interface ItemSaleAmount { amountCents: number; }

export interface ItemEarnings {
  revenueCents: number;   // Σ amountCents
  costCents: number;      // sales.length × unitCostCents
  profitCents: number;    // revenue − cost
}

/** Per-product earnings from its ledger sales. Each sale row is one unit, so the
 *  cost basis is sales.length × the item's avg unit cost — keeping revenue and
 *  cost consistent (both from the same ledger-sale set). */
export function itemEarnings(sales: ItemSaleAmount[], unitCostCents: number): ItemEarnings {
  const revenueCents = sales.reduce((a, s) => a + s.amountCents, 0);
  const costCents = sales.length * unitCostCents;
  return { revenueCents, costCents, profitCents: revenueCents - costCents };
}
