# Purchase Batches, Edit Modal & Purchase History — Design

Date: 2026-06-15
Status: Approved for spec review

## Context

The inventory table currently edits three values per row with inline number
spinners (unit cost, purchased, samples). With ~20 products that table is
cluttered, and the model only stores a **single** unit cost and a **single**
purchased quantity per item. That single-cost model can't represent buying the
same product again later at a different price, and there is no record of *when*
or *at what price* stock was bought.

This design replaces the single scalar `qty_purchased` / `unit_cost_cents` with
a **purchase-batch** model: every purchase of a product is its own dated entry
(quantity + unit cost). The item's purchased total becomes the sum of its
batches and its unit cost becomes their **weighted average**, computed
automatically. This simultaneously:

- solves "same product, different price" (re-buys blend into one average),
- gives a built-in **purchase history**, and
- lets the cluttered inline editors be replaced by a clean **Edit modal**.

This is effectively a focused slice of the roadmap's Phase 3 (cost sourcing via
lots), scoped to weighted-average costing only — no FIFO, no per-sale cost
locking.

## Decisions (locked in during brainstorming)

- **Costing method: weighted average.** Total spend ÷ total quantity. Right for
  this volume; FIFO is explicitly out of scope.
- **Batches are the source of truth.** `inventory_items.qty_purchased` and
  `unit_cost_cents` are kept but become *derived/maintained* values, recomputed
  whenever an item's purchases change. This keeps the existing report and
  Sold/Remaining math working unchanged.
- **Edit modal scope:** add a purchase, edit/delete a past purchase, edit
  samples. **No rename** (item names tie into mappings; separate concern).
- **New products** are created through a `+ Add product` modal: name + first
  purchase. Creating a product always creates its first batch.
- **Map Whatnot name / Brother transaction** cards are left as-is.
- The inline `EditableCost` / `EditableQty` editors are **retired** — their job
  moves into the modal.

## Data model

### New table `item_purchases`

```sql
CREATE TABLE IF NOT EXISTS item_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  purchased_on TEXT,            -- YYYY-MM-DD, nullable (unknown -> NULL -> "—")
  quantity INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL
);
```

### Derived item totals (maintained, not hand-edited)

On every purchase add/edit/delete, `recomputeItemTotals(db, itemId)` runs inside
the same transaction and sets:

- `qty_purchased = COALESCE(SUM(quantity), 0)`
- `unit_cost_cents = round( SUM(quantity * unit_cost_cents) / SUM(quantity) )`,
  guarded to `0` when `SUM(quantity) = 0` (no divide-by-zero).

Because `unit_cost_cents` stays populated, `ledger-report.ts` (which costs each
sold unit at `itemCost.get(itemId)`) and `qtyRemaining` need **no changes**.

### Exact inventory spend

Rounding the weighted average to whole cents can drift the dashboard's
"inventory spend" KPI if computed as `avg × qty`. So spend is computed
**exactly** from the batches:

- `itemSpendCents(db, itemId) = COALESCE(SUM(quantity * unit_cost_cents), 0)`

The dashboard's inventory-spend calc switches to summing `itemSpendCents` over
items instead of `unit_cost_cents * qty_purchased`. Per-unit COGS in the report
continues to use the rounded average (inherent and expected under weighted
average); only the headline spend total is made exact.

### Migration (no data change)

Idempotent, in the existing `connection.ts` upgrade path. For each
`inventory_items` row with `qty_purchased > 0` and **zero** existing
`item_purchases`, insert one seed batch:

- `quantity = qty_purchased`
- `unit_cost_cents = unit_cost_cents`
- `purchased_on = NULL` (real date unknown historically)

`recomputeItemTotals` then reproduces the exact original totals. Self-guarding:
an item that already has purchases is skipped, so re-running is a no-op. Items
with `qty_purchased = 0` get no seed batch (empty history until one is added).

## Components

### DB layer — `src/lib/db/purchases.ts` (new)

- `interface Purchase { id; itemId; purchasedOn; quantity; unitCostCents }`
- `listPurchases(db, itemId): Purchase[]` — ordered by `purchased_on, id` (oldest first; NULL dates first).
- `addPurchase(db, { itemId, purchasedOn, quantity, unitCostCents }): number` — insert, then `recomputeItemTotals(db, itemId)`, in a transaction. Returns new id.
- `updatePurchase(db, id, { purchasedOn, quantity, unitCostCents }): void` — update, then recompute its item, in a transaction.
- `deletePurchase(db, id): void` — look up its item_id, delete, then recompute, in a transaction.
- `recomputeItemTotals(db, itemId): void` — the derived-totals writer above.
- `itemSpendCents(db, itemId): number` — exact Σ(qty·cost).

### DB layer — `src/lib/db/inventory.ts` (modify)

- Add `createItemWithFirstPurchase(db, { name, lotId, purchasedOn, quantity, unitCostCents }): number` — inserts the item then its first purchase and recomputes, atomically. (Wraps `insertItem` + `addPurchase`.)

### API

- **`src/app/api/purchases/route.ts`** (new):
  - `POST` `{ itemId, purchasedOn, quantity, unitCostCents }` → `addPurchase`.
  - `PATCH` `{ id, purchasedOn, quantity, unitCostCents }` → `updatePurchase`.
  - `DELETE` `{ id }` → `deletePurchase`.
  - Validation mirrors the existing inventory route: integer `id`/`itemId`;
    `quantity` integer ≥ 1; `unitCostCents` finite ≥ 0; `purchasedOn` a string or
    null. Bad input → `400`. Returns `{ ok: true }` (POST also returns `{ id }`).
- **`src/app/api/inventory/route.ts`** (modify): the new-product `POST` path
  routes through `createItemWithFirstPurchase` when given `quantity` +
  `unitCostCents` (+ optional `purchasedOn`). The lot branch is unchanged. The
  samples `PATCH` branch is unchanged. The now-unused `qtyPurchased` /
  `unitCostCents` PATCH branches are removed (editing happens via purchases).

### UI

- **`src/components/PurchaseList.tsx`** (new, presentational) — renders a
  purchases table (Date / Qty / Unit cost / Total) with a weighted-average +
  total footer. Takes optional `onEdit`/`onDelete` callbacks; when omitted it
  renders read-only (used on the detail page).
- **`src/components/EditItemModal.tsx`** (new, client) — opened by a row's
  **Edit** button. Contains `PurchaseList` with edit/delete, an "Add a purchase"
  form (date default today / qty / unit cost), live Purchased + Avg-cost totals,
  and the **Samples** number field (→ samples `PATCH /api/inventory`). Purchase
  actions hit `/api/purchases`. Closing calls `router.refresh()`.
- **`src/components/AddProductModal.tsx`** (new, client) — opened by a
  `+ Add product` button above the table. Fields: name + first purchase
  (date/qty/unit cost) → `POST /api/inventory`. Refresh on success.
- **`src/components/InventoryTable.tsx`** (modify) — remove inline
  `EditableCost`/`EditableQty`; show read-only Unit cost (avg), Purchased (sum),
  Samples, and an **Edit** button per row that opens `EditItemModal`. Add the
  `+ Add product` button.
- **`src/components/InventoryForms.tsx`** (modify) — remove the "Add item" card
  (replaced by `AddProductModal`); keep "Map Whatnot name" and "Brother
  transaction" cards.
- **`src/app/inventory/[id]/page.tsx`** (modify) — add a **"Purchases"** card
  (read-only `PurchaseList`) above the "Ledger sales" section.
- Retire `src/components/EditableCost.tsx` and `src/components/EditableQty.tsx`
  (no remaining consumers after the table refactor).

## Data flow

1. **Add product** → `AddProductModal` → `POST /api/inventory` →
   `createItemWithFirstPurchase` (item + batch #1 + recompute).
2. **Restock / correct** → row Edit → `EditItemModal` → `/api/purchases`
   add/edit/delete → recompute → modal close → table refresh shows new avg/sum.
3. **Report/dashboard** read the maintained `unit_cost_cents` (per-unit COGS)
   and `itemSpendCents` (exact spend) — no behavior change beyond the spend
   source swap.

## Edge cases

- **Delete last purchase:** allowed; totals recompute to 0. Item remains.
- **Delete item:** unchanged `deleteItem`; `ON DELETE CASCADE` removes its
  purchases automatically.
- **Σqty = 0:** unit cost guarded to 0.
- **Quantity** must be integer ≥ 1; **cost** ≥ 0; enforced in API and forms.
- **Date** optional → `NULL` → displayed as `—`; add form defaults to today.
- **Samples** independent of purchases; `remaining = Σqty − sold − samples`.

## Error handling

- All purchase mutations run in a transaction with `recomputeItemTotals`, so the
  maintained totals can never desync from the batch rows.
- Modals show an inline error + retry on a failed fetch, matching the existing
  `UnmapButton` / `DeleteItemButton` pattern.

## Test plan

vitest, focused on the db layer (where the codebase concentrates tests):

- `addPurchase` appends a batch and recomputes totals; 12@$1.50 + 12@$1.80 →
  `qty_purchased = 24`, `unit_cost_cents = 165` (weighted average).
- `updatePurchase` and `deletePurchase` recompute correctly; deleting the last
  batch zeroes `qty_purchased` and `unit_cost_cents`.
- `itemSpendCents` returns exact Σ(qty·cost) with no rounding drift.
- `createItemWithFirstPurchase` inserts item + first batch atomically and sets
  totals.
- **Migration backfill**: an item written the old way (scalar qty/cost, no
  purchases) gets exactly one seeded batch reproducing its original totals;
  running the upgrade twice does not duplicate batches.
- `qtyRemaining` / `qtySold` stay correct after purchases change.
- Dashboard inventory-spend equals Σ `itemSpendCents` across items.

Modals and routes stay lightly tested (thin layers), consistent with the
codebase.

## Out of scope

- FIFO or any per-sale cost locking (weighted average only).
- Renaming items.
- Reworking the Map / Brother cards.
- Editing or dating the historical backfill batches beyond what the modal
  already allows.
- Tying `item_purchases` into the existing `lots` table (left independent).
