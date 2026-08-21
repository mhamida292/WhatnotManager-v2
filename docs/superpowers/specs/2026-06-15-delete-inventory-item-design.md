# Delete Inventory Item — Design (Phase 2)

Date: 2026-06-15
Status: Approved for spec review

## Context

The Whatnot Business Manager lets you add inventory items and edit their
quantities, but never remove one. Items get added by mistake, duplicated, or go
out of stock, and there's no way to clean them up.

This is **Phase 2** of the roadmap in
`2026-06-13-ledger-import-and-report-design.md`, originally scoped as "delete
inventory items, edit quantity on hand." The quantity-editing half is already
built (`EditableQty` for Purchased and Samples, backed by `updateItemQty` /
`updateItemSamples` and `PATCH /api/inventory`), so this spec covers **delete
only**.

## What references an inventory item

A delete has to account for everything tied to the item:

- **`product_aliases.item_id`** — Whatnot product names mapped to the item.
  These drive ledger sales counting (`qtySoldFromLedger` resolves live through
  this map).
- **`show_line_items.item_id`** — legacy per-show sales.
- **`brother_transactions.item_id`** — split shipments / gave-to-brother.
- **`lots`** — the lot the item belongs to (via `inventory_items.lot_id`).

The **ledger sales themselves (`ledger_transactions`) are never tied to an item
directly** — they're keyed by Whatnot product name and resolved through
`product_aliases`. This is what makes deletes recoverable (see below).

## Decision: warn + cascade

Deleting an item performs a cascade, but the confirmation dialog spells out the
blast radius first. Chosen over "block until unmapped" (too tedious for a
genuinely-wrong item) and "cascade silently" (a delete silently changes the
profit report).

On delete, in a single transaction:

1. **Delete the item's `product_aliases` rows.** The mapped Whatnot names become
   unmapped again — their ledger sales stop counting toward any item.
2. **Clear `item_id` to NULL** on any `show_line_items` and
   `brother_transactions` that referenced the item (rows are kept, just
   detached).
3. **Delete the `inventory_items` row.** Lots are left as-is.

### Recoverability

- **Ledger mappings are fully recoverable.** Because ledger sales are keyed by
  product name (not item id) and survive the delete, re-adding the item and
  re-mapping the same Whatnot names makes `qtySoldFromLedger` re-count them
  live. Sold / Remaining / profit all return.
- **Legacy show/brother links are NOT auto-recoverable.** Those rows referenced
  the item by `item_id` with no product name to re-map by, so re-adding the item
  won't re-attach them. For current ledger-based items this is typically moot,
  but the warning surfaces any such rows so there's no surprise.

## Components

### `lib/db/inventory.ts`

- **`deleteImpact(db, itemId): { mappings, ledgerSales, showLineSales, brotherTxns }`**
  — counts used to build the warning. `mappings` = alias rows for the item;
  `ledgerSales` = ledger sale rows resolving to it (mirrors `qtySoldFromLedger`);
  `showLineSales` = `show_line_items` with this `item_id`; `brotherTxns` =
  `brother_transactions` with this `item_id`.
- **`deleteItem(db, itemId): void`** — wraps the three cascade steps in a
  transaction. If any step throws, nothing is deleted (no half-detached state).

### `DELETE /api/inventory`

Added alongside the existing GET / POST / PATCH handlers. Accepts `{ id }`,
validates `id` is an integer, returns `404` if the item doesn't exist, otherwise
calls `deleteItem` and returns `{ ok: true }`.

### `DeleteItemButton.tsx` (client)

Mirrors the existing `UnmapButton` pattern. A red "Delete item" button that:

1. Pops a `confirm()` built from `deleteImpact` (see below).
2. On confirm, `fetch("/api/inventory", { method: "DELETE", body: { id } })`.
3. On success, `router.push("/inventory")`. On failure, shows a "Retry" state.

### `/inventory/[id]/page.tsx`

Renders `DeleteItemButton` at the bottom of the detail page and passes the item
id and the `deleteImpact` counts (the page already loads the item and its
sales/mappings).

## Confirmation message

Built from `deleteImpact`, omitting zero counts for readability:

> Delete "Regular Butter Squishy"? This removes 1 mapping (11 ledger sales will
> become unmapped) and clears the item from 2 brother transactions. The sales
> data is kept — re-add and re-map to restore ledger counts.

The "re-add and re-map to restore" reminder is always shown so the recovery path
is obvious at the moment of deleting.

## Error handling

- `deleteItem` is transactional — a mid-delete failure rolls back, leaving the
  item and all links intact.
- The DELETE route returns `400` for a malformed id and `404` for a missing
  item; the button surfaces a "Retry" state on any non-ok response or network
  error.
- Deleting an item with no mappings/sales just works — no special case.

## Test plan

vitest, in `tests/lib/db/inventory.test.ts`:

- `deleteItem` removes the item row and its alias rows; the freed product names
  resolve to null afterward (`resolveItemId` → null), and a re-added item with
  the same names re-counts the surviving ledger sales via `qtySoldFromLedger`.
- `deleteItem` sets `item_id = NULL` on referencing `show_line_items` and
  `brother_transactions` rather than deleting those rows.
- `deleteItem` of an item with no references succeeds and only removes the row.
- `deleteImpact` returns correct counts for mappings, ledger sales, show-line
  sales, and brother transactions.
- Transaction rollback: a forced failure mid-delete leaves the item and all
  links intact.

API-route and component testing stays light, consistent with the codebase
(thorough db-layer tests; thin routes/UI left untested).

## Out of scope

- Editing quantity on hand (already implemented).
- A delete action in the inventory table row (detail-page only by decision).
- Deleting or garbage-collecting empty lots after their last item is removed.
- Re-attaching legacy show/brother links after a re-add (not supported).
