import { LOW_STOCK_THRESHOLD } from "@/lib/calc/stock-status";

export type StockFilter = "all" | "in" | "low" | "out";
export type ArchiveFilter = "active" | "archived" | "all";
export interface FilterableItem { name: string; remaining: number; archivedAt?: string | null; }
export interface InventoryFilter { search: string; status: StockFilter; archive?: ArchiveFilter; }

/** Filter inventory rows by name substring (case-insensitive), stock status and
 *  whether the item is archived. Status buckets reuse LOW_STOCK_THRESHOLD so
 *  they match the stock badge. Archive defaults to 'active', so a caller that
 *  passes archived rows without asking for them still sees only live stock.
 *  Returns a new array; input is not mutated. */
export function filterInventory<T extends FilterableItem>(items: T[], f: InventoryFilter): T[] {
  const q = f.search.trim().toLowerCase();
  const archive = f.archive ?? "active";
  return items.filter((i) => {
    // A row with no archivedAt at all is a live item, not an unknown.
    const isArchived = i.archivedAt != null;
    if (archive === "active" && isArchived) return false;
    if (archive === "archived" && !isArchived) return false;
    if (q && !i.name.toLowerCase().includes(q)) return false;
    switch (f.status) {
      case "out": return i.remaining <= 0;
      case "low": return i.remaining > 0 && i.remaining <= LOW_STOCK_THRESHOLD;
      case "in":  return i.remaining > LOW_STOCK_THRESHOLD;
      default:    return true;
    }
  });
}
