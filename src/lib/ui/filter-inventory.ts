import { LOW_STOCK_THRESHOLD } from "@/lib/calc/stock-status";

export type StockFilter = "all" | "in" | "low" | "out";
export interface FilterableItem { name: string; remaining: number; }
export interface InventoryFilter { search: string; status: StockFilter; }

/** Filter inventory rows by name substring (case-insensitive) and stock status.
 *  Status buckets reuse LOW_STOCK_THRESHOLD so they match the stock badge.
 *  Returns a new array; input is not mutated. */
export function filterInventory<T extends FilterableItem>(items: T[], f: InventoryFilter): T[] {
  const q = f.search.trim().toLowerCase();
  return items.filter((i) => {
    if (q && !i.name.toLowerCase().includes(q)) return false;
    switch (f.status) {
      case "out": return i.remaining <= 0;
      case "low": return i.remaining > 0 && i.remaining <= LOW_STOCK_THRESHOLD;
      case "in":  return i.remaining > LOW_STOCK_THRESHOLD;
      default:    return true;
    }
  });
}
