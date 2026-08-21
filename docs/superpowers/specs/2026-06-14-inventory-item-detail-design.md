# Inventory item detail page — design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Problem

The inventory table shows aggregate counts (purchased / sold / samples / remaining) but
no way to see *what* makes up the "sold" number or *which* Whatnot product names feed an
item. When a remaining count looks wrong, the user can't drill in to reconcile it. They
want to click an item and see its individual sales and its name-mappings.

(Context: this surfaced while debugging an inflated `remaining`. Sold is computed
correctly — every ledger sale is one unit and all are mapped — so a per-item breakdown is
the right tool to spot whether the discrepancy is in `qty_purchased` or in missing/extra
mappings.)

## Scope

A read-most detail page per inventory item, plus the ability to remove a wrong mapping.

In scope:
- Clickable item name → new page at `/inventory/[id]`.
- Summary of the item's stock math with the **sold figure broken down** by channel.
- List of Whatnot product-name mappings (aliases) feeding the item, each with its sale count.
- List of the individual ledger sale rows that count against the item.
- An **Unmap** button on each mapping to detach a wrong Whatnot name.

Out of scope (YAGNI): adding new mappings from this page (the Inventory page's existing
"Map Whatnot name → item" box already does that), editing sales, legacy show-line drill-in
beyond a count.

## Architecture

Follows the existing `/shows/[id]` server-component pattern. No new libraries.

### Navigation
- `InventoryTable` (`src/components/InventoryTable.tsx`): wrap the item **name** in
  `<Link href={`/inventory/${i.id}`}>`. The badge stays next to it. The editable
  `qtyPurchased` / `qtySamples` cells are untouched (separate cells, so the link doesn't
  swallow their clicks).

### New page: `src/app/inventory/[id]/page.tsx`
Server component, `export const dynamic = "force-dynamic"`. Loads the item; if missing,
renders a "not found" block like `/shows/[id]` does. Three blocks:

1. **Summary card** (mirrors show-detail's summary table):
   - Unit cost, Purchased, Samples, Remaining.
   - **Sold (broken down):** Ledger sales / Legacy show sales / Gave to brother, then the
     total. Computed from the existing `qtySoldFromLedger`, `qtySoldByItem`,
     `qtyGivenToBrother` helpers so the numbers always match the table.

2. **Mappings card:** one row per alias pointing at this item — the Whatnot product name,
   its sale count, and an **Unmap** button. Empty state: "No Whatnot names mapped to this
   item yet." Unmap shows a confirm and explains the consequence (those sales stop counting
   as sold for this item, so remaining rises and their COGS drops to $0 until re-mapped).

3. **Sales table** (`DataTable`): every ledger `sale` row mapped to this item — Show date,
   Whatnot product name, Amount (`Money`). Ordered by date. Header notes the row count.

### New DB helpers (`src/lib/db/inventory.ts`), pure reads:
- `aliasesForItem(db, itemId)` → `{ id, productName, saleCount }[]`
  (`product_aliases` for the item, left-joined to `ledger_transactions` sale counts).
- `ledgerSalesForItem(db, itemId)` → `{ showDate, productName, amountCents }[]`
  (`ledger_transactions` joined via `product_aliases`, `kind='sale'`, ordered by `show_date`).

### Unmap endpoint
- `removeAlias(db, aliasId)` in `src/lib/db/aliases.ts` → `DELETE FROM product_aliases WHERE id = ?`.
- `DELETE` handler in `src/app/api/aliases/route.ts` reading `{ aliasId }` from the body,
  mirroring the existing `POST`. Returns `{ ok: true }`.
- Client interaction: a small client component for the mapping row's Unmap button that
  calls the endpoint then `router.refresh()` (same approach as `EditableQty`).

## Data flow

Page (server) → `getDb()` → `listItems`/item lookup + `qtySold*` helpers +
`aliasesForItem` + `ledgerSalesForItem` → rendered with `Card` / `DataTable` / `Money`.
Unmap: client button → `DELETE /api/aliases` → `removeAlias` → `router.refresh()`
re-renders the server page with updated mappings, sales, and the recomputed remaining.

## Error handling
- Unknown/`NaN` id → "Item not found" block (no throw), like show-detail.
- Unmap failure → leave the row, surface a simple error (alert or inline), no optimistic removal.

## Testing
- Unit (Vitest), against an in-memory DB seeded with an item, two aliases, and sale rows:
  - `aliasesForItem` returns both aliases with correct per-alias sale counts.
  - `ledgerSalesForItem` returns one row per mapped sale, ordered by date.
  - `removeAlias` deletes only the targeted alias; afterward `qtySoldFromLedger` for the
    item drops by that alias's sale count (proving remaining rises) and the other alias is
    untouched.
- No UI/integration test framework exists in the repo; verify the page manually.
