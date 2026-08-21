export interface InStockItem { remaining: number; unitCostCents: number; }

export interface InStockSummary {
  units: number;            // Σ max(remaining, 0)
  valueCents: number;       // Σ max(remaining, 0) × unitCostCents
  productsInStock: number;  // count of items with remaining > 0
  totalProducts: number;    // items.length
}

/** On-hand stock derived from per-item remaining + avg unit cost. Negative
 *  remaining (oversold) is clamped to 0 per item so one bad row never drags the
 *  totals below the true on-hand count. */
export function inStockSummary(items: InStockItem[]): InStockSummary {
  let units = 0, valueCents = 0, productsInStock = 0;
  for (const it of items) {
    const onHand = Math.max(it.remaining, 0);
    units += onHand;
    valueCents += onHand * it.unitCostCents;
    if (it.remaining > 0) productsInStock += 1;
  }
  return { units, valueCents, productsInStock, totalProducts: items.length };
}
