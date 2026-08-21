# On-Screen Bundles — Design

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with the user

## Problem

The user sells "on-screen bundles" on stream: a single Whatnot listing that combines several
different inventory items into one offering at one combined price. Each bundle is unique —
bundle #1 and bundle #2 have different contents, different prices, and different profit, and a
single stream may contain multiple distinct bundles.

A bundle lands in the Whatnot ledger as **one sale line** (one product name, one combined
`amount_cents`, its own Whatnot order). Today the profit report computes COGS by mapping a
product name to **exactly one** inventory item via `product_aliases`. A bundle therefore cannot
be costed correctly: it is either unmapped (counted at $0 cost, profit overstated) or mapped to a
single item (cost undercounted). The user wants accurate profit per bundle: `revenue − Σ(component costs)`.

## Goals

- Capture the true cost of a bundle as the sum of its component inventory items' costs.
- Show per-bundle profit (revenue − cost) inline on the show's Products table and rolled into the Report totals.
- Support **multiple, fully independent** bundles per show. Two bundles never merge, even if titled identically.
- Require **no pre-defined catalog** — bundles are defined ad-hoc on the show they occurred in.

## Non-Goals

- **No stock drawdown** (explicit user decision). Defining a bundle does **not** reduce its
  component items' `remaining`/`sold` counts. Bundles affect profit only.
- **No reusable bundle recipes / catalog.** Every stream's bundles are different; there is nothing to reuse.
- **No manual-revenue bundles.** A bundle is always tied to an existing ledger sale line, which
  supplies its revenue. (A bundle that never came through as a single ledger line is out of scope;
  revisit if the user hits that case.)

## Key Design Decisions

1. **A bundle is keyed to an individual ledger sale line, not to a product name.** Each on-screen
   bundle is one Whatnot order = one row in `ledger_transactions` (kind `sale`). Components attach
   to that row's `id`. This guarantees independence: two bundles with the same name stay separate
   because they are different ledger rows.

2. **The sale line IS the bundle header.** No separate "bundle" row is needed — the ledger sale
   line already supplies the bundle's name (`product_name`) and revenue (`amount_cents`). A bundle
   is simply "a ledger sale line that has one or more component rows attached."

3. **Component costs are live.** Cost uses each inventory item's current `unit_cost_cents` at
   report-build time, consistent with how the existing report resolves COGS.

4. **Components override alias cost for bundle lines.** If a bundle line's product name also happens
   to be alias-mapped to an item, the alias is ignored for that line; the component sum is authoritative.

5. **Searchable item picker.** Picking an inventory item (both in the existing "Map Whatnot name →
   item" form and in the new bundle editor's component rows) uses a type-to-filter combobox built on
   the native `<datalist>` element — the same pattern the product-name field already uses. No new
   dependencies. The user types/selects an item by name; the component resolves the name to the item
   id (item names are `UNIQUE`). This is shared as one `ItemCombobox` component.

## Data Model

One new table (mirrors the giveaway-allocation pattern):

```sql
CREATE TABLE IF NOT EXISTS bundle_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_txn_id INTEGER NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty INTEGER NOT NULL
);
```

- `ledger_txn_id` → the sale line that is the bundle. `ON DELETE CASCADE` so deleting a show
  (which cascade-deletes its `ledger_transactions`) also removes its bundle components.
- A sale line is "a bundle" iff it has ≥1 row here.
- Re-importing the ledger is idempotent (`INSERT OR IGNORE` on `dedup_key`), so existing
  `ledger_transactions.id` values are stable and these FKs survive re-imports.

## Components / Modules

### `src/lib/db/bundles.ts` (new)
Single-purpose DB access for bundles.

- `listShowSaleLines(db, showId): { id, productName, amountCents }[]`
  — sale-kind ledger transactions for the show, to populate the "which line is the bundle" dropdown.
- `getShowBundles(db, showId): { ledgerTxnId, productName, amountCents, components: { itemId, qty }[] }[]`
  — existing bundles for the show, grouped by sale line.
- `setShowBundles(db, showId, bundles): void`
  — replace-all within a transaction: delete `bundle_components` for the show's sale lines, then
  re-insert from the payload. Mirrors `setAllocations`.
- `getBundleComponentsByTxn(db, showId): Map<txnId, { itemId, qty }[]>`
  — helper for the report builder.

### `src/lib/calc/ledger-report.ts` (modified)
In `buildLedgerReport`, when iterating a show's transactions:

- Load the show's bundle component map once.
- For a `sale` txn **with** components: emit a **dedicated** `ReportProductLine` (do NOT merge into
  the name-grouped `productMap`). Set `qty = 1`, `revenueCents = amountCents`,
  `costCents = Σ(component.qty × item.unitCostCents)`, `mapped = true`,
  `profitCents = revenue − cost`, plus new fields `isBundle: true` and
  `components: { name, qty, unitCostCents, costCents }[]`.
- For a `sale` txn **without** components: group by product name exactly as today.
- COGS, net, totals roll up unchanged (they already sum product-line costs).

`ReportProductLine` gains optional fields: `isBundle?: boolean`, `components?: ReportBundleComponent[]`.

### `src/app/api/shows/[id]/bundles/route.ts` (new)
Mirrors `/api/shows/[id]/giveaways`.
- `GET` → `{ saleLines, items, bundles }` where `items` is the inventory list (id, name, unitCostCents).
- `PUT` → body `{ bundles: { ledgerTxnId, components: { itemId, qty }[] }[] }`; validates
  `qty > 0` and known ids, drops empty bundles, calls `setShowBundles`.

### `src/components/ItemCombobox.tsx` (new, client)
Shared type-to-filter item picker over a native `<datalist>`. Props: `items`, `value` (item id or
null), `onChange(id | null)`, `listId`, `placeholder`. Manages its own text state; reports the
matched item id (or null while the typed text matches no item). Used by both the Map form and the
bundle editor. Consumers disable their submit when the resolved id is null.

### `src/components/InventoryForms.tsx` (modified)
Replace the plain item `<select>` in the "Map Whatnot name → item" form with `ItemCombobox`. Disable
the "Map" button when no item is resolved.

### `src/components/BundleEditor.tsx` (new, client)
Mirrors `GiveawayAllocationEditor.tsx`. Component item rows use `ItemCombobox` instead of a `<select>`.
- Fetches `GET /api/shows/[id]/bundles` on mount.
- Renders a list of bundle cards. Each card: a "sale line" `<select>` (the show's sale lines) +
  component rows (item `<select>` + qty `<input>` + remove), with live cost/revenue/profit readout.
- "+ Add another bundle" adds a card; "Save bundles" PUTs the payload.
- Guards against assigning the same sale line to two bundle cards.

### `src/app/shows/[id]/page.tsx` (modified)
Add a `Card title="Bundles"` containing `<BundleEditor showId=… />`, directly below the existing
"Giveaway Allocations" card. The Products table already renders `ReportProductLine`s, so bundle
rows appear automatically; add a small "▸ N items" bundle indicator (and optionally list components).

### `src/lib/db/schema.ts` (modified)
Append the `bundle_components` table to `SCHEMA`.

## Data Flow

1. User imports the Whatnot ledger (existing flow). The bundle's combined sale becomes one
   `ledger_transactions` row (kind `sale`).
2. On the show page, user opens the **Bundles** editor, picks that sale line, and adds component
   items + quantities. Saving writes `bundle_components` rows.
3. `buildLedgerReport` detects the sale line has components, emits a dedicated bundle line costed at
   the component sum, and computes profit = ledger revenue − component cost.
4. The bundle appears as its own row on the show's Products table and the Report, and its cost flows
   into COGS / net / owner-share totals like any other product line.

## Error Handling & Edge Cases

- **Empty bundle:** a card with no components (or all qty 0) is dropped on save; the sale line
  reverts to normal name-grouped behavior.
- **Same line chosen twice:** editor prevents it; on the server, replace-all semantics mean the last
  write wins per line anyway.
- **Component item deleted:** `item_id` has no cascade; deleting an inventory item in use should be
  guarded the same way the giveaway catalog guards in-use items (out of scope here, but note for the plan).
- **Show deleted / ledger re-imported:** `ON DELETE CASCADE` via `ledger_txn_id` keeps components
  consistent; idempotent import preserves txn ids.
- **No stock impact:** components are not alias-mapped, so `remaining`/`sold` counts are untouched by design.

## Testing

Follow existing Vitest patterns.
- `ledger-report` unit tests: a sale line with components produces a separate bundle line with
  `cost = Σ components`, correct profit, and does not merge with same-named non-bundle lines;
  multiple bundles in one show stay independent; bundle cost overrides any alias mapping.
- `bundles` DB tests: `setShowBundles` replace-all, `getShowBundles` grouping, cascade on show delete.
- Confirm COGS / net / owner-share totals include bundle cost.

## Out of Scope / Future

- Manual-revenue bundles (no matching ledger line).
- Reusable bundle templates (only if the user later finds themselves repeating bundles).
- Optionally drawing bundle components down from stock (explicitly declined now).
