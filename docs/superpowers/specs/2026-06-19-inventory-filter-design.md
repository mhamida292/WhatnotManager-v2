# Inventory filter — design

**Date:** 2026-06-19

## Problem

The inventory list (`InventoryTable`) supports column sorting but no filtering.
With many items the user can't quickly narrow to a product or to items that need
attention (low/out of stock).

## Goal

Add client-side filtering to the inventory table: a name search and a stock-status
filter. No API or DB changes.

## Non-goals

- No server-side filtering/pagination (the dataset is small; client-side is fine).
- No new filter dimensions beyond name + stock status (YAGNI).

## Design

### Filter helper — `src/lib/ui/filter-inventory.ts` (new)
Pure, unit-testable function, separate from the component:
```ts
import { LOW_STOCK_THRESHOLD } from "@/lib/calc/stock-status";

export type StockFilter = "all" | "in" | "low" | "out";
export interface FilterableItem { name: string; remaining: number; }

export interface InventoryFilter { search: string; status: StockFilter; }

export function filterInventory<T extends FilterableItem>(items: T[], f: InventoryFilter): T[] {
  const q = f.search.trim().toLowerCase();
  return items.filter((i) => {
    if (q && !i.name.toLowerCase().includes(q)) return false;
    switch (f.status) {
      case "out": return i.remaining <= 0;
      case "low": return i.remaining > 0 && i.remaining <= LOW_STOCK_THRESHOLD;
      case "in":  return i.remaining > LOW_STOCK_THRESHOLD;
      default:    return true; // "all"
    }
  });
}
```
The status buckets reuse `LOW_STOCK_THRESHOLD` so they stay consistent with the
existing `stockBadge` (out ≤ 0; low 1..threshold; in > threshold).

### Component — `src/components/InventoryTable.tsx`
- Add two pieces of state: `search` (string) and `status` (`StockFilter`,
  default `"all"`).
- Render a filter bar above the table: a text input bound to `search`
  (placeholder "Search items…") and a `<select>` for status
  (All / In stock / Low / Out).
- Apply `filterInventory(items, { search, status })` **before** the existing
  `sortInventory(...)`.
- When the filtered list is empty, render a single full-width row: "No items
  match your filters."

The filter bar uses existing UI classes (`INPUT_CLASS`); no new design system work.

## Testing (Vitest) — `tests/lib/ui/filter-inventory.test.ts`
- Name search is case-insensitive substring; trims whitespace; empty search
  returns all.
- `out` returns only `remaining <= 0`; `low` returns `1..LOW_STOCK_THRESHOLD`;
  `in` returns `> LOW_STOCK_THRESHOLD`; `all` returns everything.
- Search + status combine (AND).
- Input array is not mutated.

## Risks

- None significant; pure client-side, additive. Filtering composes with sorting
  because both return new arrays.
