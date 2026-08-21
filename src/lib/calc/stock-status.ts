export const LOW_STOCK_THRESHOLD = 3;

export interface StockBadge {
  label: string;
  className: string;
}

/** Maps an item's remaining count to a UI badge, or null when comfortably in stock.
 *  remaining <= 0 -> "Out of stock"; 1..LOW_STOCK_THRESHOLD -> "Low". */
export function stockBadge(remaining: number): StockBadge | null {
  if (remaining <= 0) return { label: "Out of stock", className: "bg-red-100 text-red-700" };
  if (remaining <= LOW_STOCK_THRESHOLD) return { label: "Low", className: "bg-amber-100 text-amber-700" };
  return null;
}
