export interface InStockItem { remaining: number; unitCostCents: number; }

export interface InStockSummary {
  units: number;            // Σ max(remaining, 0)
  valueCents: number;       // Σ max(remaining, 0) × unitCostCents
  productsInStock: number;  // count of items with remaining > 0
  totalProducts: number;    // items.length
  avgUnitCostCents: number; // valueCents / units, 0 when nothing is on hand
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
  // Derived from the two totals above rather than averaged across items, so the
  // card can never disagree with the value and unit counts sitting next to it.
  const avgUnitCostCents = units > 0 ? Math.round(valueCents / units) : 0;
  return { units, valueCents, productsInStock, totalProducts: items.length, avgUnitCostCents };
}
