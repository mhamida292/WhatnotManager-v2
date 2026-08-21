# Whatnot vs Warehouse Stock Buckets — Design

**Date:** 2026-07-18
**Status:** Approved (pending spec review)

## Context

The app currently tracks a single on-hand quantity per inventory item, derived
from event tables: `item_purchases` (received), sales (Whatnot ledger via the
alias map, wholesale invoices, "gave to brother"), and `inventory_adjustments`
(sample/damage/recount). `qtyRemaining = qty_purchased − qtySold + Σadjustments`.

The owner wants Whatnot inventory **separated** from Warehouse inventory using the
"same product, two stock buckets" model (option C): each product holds a
**Warehouse** quantity and a **Whatnot** quantity, and stock moves between them.

**Key invariant:** the two buckets are a *partition* of the existing on-hand.
`Warehouse + Whatnot == qtyRemaining` (today's number). Therefore profit, COGS,
and report math are unaffected — this change only splits on-hand into two derived
buckets and adds one new event type (**moves**).

## Goals

1. Each item exposes a derived **Warehouse qty** and **Whatnot qty** (plus Total).
2. A **Move** action transfers units between the two buckets (with a move log).
3. **Whatnot ledger sales auto-deduct the Whatnot bucket** (via the existing alias
   map); **wholesale invoices + "gave to brother" deduct the Warehouse bucket**.
4. **Receiving** lands in the Warehouse bucket.
5. **Overselling** the Whatnot bucket shows a negative in red with an "oversold"
   warning; nothing is blocked.
6. Adjustments carry a **channel** (Warehouse/Whatnot), defaulting to Warehouse.
7. **Fresh start:** no migration; new items begin at 0/0.

## Out of Scope

- No change to cost/COGS/profit calculations (Total on-hand is unchanged).
- No change to the Whatnot ledger import, shows, or alias-mapping mechanics
  (they continue to resolve sales to items; we only route the deduction to the
  Whatnot bucket).
- No two independent item lists (rejected option A) and no per-item channel tags
  (rejected option B).

---

## 1. Bucket Derivation

Two new pure functions in `src/lib/db/inventory.ts` (mirroring the existing
`qtyRemaining`/`qtySold` style), each computed from events:

```
whatnotQty(item)   = movesIntoWhatnot − movesOutOfWhatnot
                     − whatnotLedgerSales − whatnotAdjustments

warehouseQty(item) = qtyPurchased − movesIntoWhatnot + movesOutOfWhatnot
                     − wholesaleSales − gaveToBrother − warehouseAdjustments
```

- `whatnotLedgerSales` = existing `qtySoldFromLedger` (alias-resolved) + legacy
  confirmed `show_line_items` sales (`qtySoldByItem`) — both are Whatnot-channel.
- `wholesaleSales` = existing `qtySoldWholesale`; `gaveToBrother` =
  `qtyGivenToBrother`.
- Adjustments are split by their new channel column (see §5).
- **Invariant check (tested):** `warehouseQty + whatnotQty === qtyRemaining` for
  any item, for all event combinations.

`qtyRemaining` itself stays as-is (total on-hand) and remains the number used by
reports/COGS/spend — nothing downstream changes.

## 2. Moves

New table:
```sql
CREATE TABLE IF NOT EXISTS inventory_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  moved_on TEXT,                 -- ISO date
  qty INTEGER NOT NULL,          -- always positive
  direction TEXT NOT NULL CHECK (direction IN ('to_whatnot','to_warehouse')),
  note TEXT
);
```
- `movesIntoWhatnot` = Σ qty where direction='to_whatnot';
  `movesOutOfWhatnot` = Σ qty where direction='to_warehouse'.
- DB helpers: `addMove(db, {itemId, qty, direction, movedOn?, note?})`,
  `listMoves(db, itemId)`.
- Brand-new table via `CREATE TABLE IF NOT EXISTS` in `schema.ts` (no PRAGMA
  guard needed — `createDb` runs the schema on every open).

### Move UI + API
- `⇄ Move` button per inventory row opens a small modal: quantity + direction
  (Warehouse→Whatnot default) + optional date/note.
- `POST /api/inventory/move` → `addMove`. Validates qty ≥ 1 and item exists.
- Moving more than a bucket holds is **allowed** (mirrors the oversold rule);
  the resulting bucket just goes negative and is flagged.

## 3. Sales Routing

No change to how sales are recorded — only how they're bucketed in the derivation
(§1). Whatnot ledger/show sales pull from Whatnot; wholesale/brother pull from
Warehouse. This is entirely in the new `whatnotQty`/`warehouseQty` functions;
existing sale-recording code is untouched.

## 4. Receiving

`addPurchase` (Task from prior work) continues to add received stock; it feeds
`qty_purchased`, which the derivation attributes to the **Warehouse** bucket. No
change to receiving code.

## 5. Adjustments Channel

Add a nullable `channel` column to `inventory_adjustments`:
```sql
ALTER TABLE inventory_adjustments ADD COLUMN channel TEXT;  -- 'warehouse' | 'whatnot' | NULL(=warehouse)
```
- Idempotent guarded migration in `connection.ts` `migrate()`.
- `NULL` is treated as `warehouse` (back-compat for any pre-existing rows).
- `whatnotAdjustments` = Σ adjustments where channel='whatnot';
  `warehouseAdjustments` = the rest.
- Recount/damage UI gains a channel selector (default Warehouse). The count-sheet
  recount defaults to Warehouse.

## 6. Overselling / Negatives

- When `whatnotQty < 0` (or `warehouseQty < 0`), the inventory table renders that
  cell in red with an "oversold" affordance (e.g. a small ⚠ and tooltip "sold
  more than moved in — move more stock in").
- No blocking anywhere; negatives are informational.

## 7. Inventory Table

`InventoryTable` gains columns: **Warehouse · Whatnot · Total** (Total =
`qtyRemaining`). The per-row `⇄ Move` action is added. Existing sort/filter,
location, receive, and archive behavior are preserved. The page's item query
(`listItems` + per-item derived numbers) is extended to include
`warehouseQty`/`whatnotQty` alongside the existing `qtyRemaining`/`sold`.

## 8. Fresh Start (No Migration)

New items begin with no purchases and no moves → Warehouse 0 / Whatnot 0. As the
owner receives stock and records moves and Whatnot sales, the buckets populate.
No backfill of historical data is required or performed.

## Testing

Follow existing `tests/lib/db/inventory.test.ts` patterns (`createDb(":memory:")`):

- **Invariant:** across a scripted sequence (purchase 100, move 30 to Whatnot,
  1 Whatnot ledger sale, 1 wholesale sale, a Whatnot recount, a Warehouse
  damage), assert `warehouseQty + whatnotQty === qtyRemaining` at each step.
- **whatnotQty:** move-in minus move-out minus ledger sales minus Whatnot
  adjustments; goes negative when sales exceed moves-in.
- **warehouseQty:** purchases minus moves-out(net) minus wholesale/brother minus
  Warehouse adjustments.
- **addMove/listMoves:** direction sums, positive-qty enforcement.
- **Adjustment channel:** NULL counts as Warehouse; 'whatnot' routes to the
  Whatnot bucket; migration adds the column idempotently on a pre-existing DB.
- Existing inventory/report/COGS tests must stay green (Total unchanged).

## Migration & Data Safety

- New `inventory_moves` table (additive) + one additive `channel` column on
  `inventory_adjustments` (guarded migration). No destructive changes.
- Because Total on-hand is unchanged by construction, all existing quantity,
  spend, and profit computations are unaffected.
