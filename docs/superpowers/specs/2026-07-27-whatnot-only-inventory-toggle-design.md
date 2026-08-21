# Whatnot-Only Inventory Toggle — Design

**Date:** 2026-07-27
**Status:** Approved (pending spec review)
**Depends on:** `2026-07-27-remove-brother-concept-design.md` (implement that first)

## Context

The app splits each item's on-hand stock into a **Warehouse** bucket and a
**Whatnot** bucket (`2026-07-18-whatnot-warehouse-stock-buckets-design.md`), with
a Move action to shift units between them.

The owner is currently selling **only on Whatnot** and is not wholesaling yet, so
the split is noise: every item's stock is Whatnot stock. They want to stash the
distinction behind a settings toggle and turn it back on when wholesaling starts.

**Key existing invariant, preserved throughout:**
`warehouseQty + whatnotQty === qtyRemaining`. Since `qtyRemaining` is what every
report, COGS, and profit figure already uses, none of this touches money math.

## Goals

1. A settings toggle that hides the Warehouse/Whatnot split and presents one
   stock number.
2. **Gated entry:** the mode can only be turned on when every item's Warehouse
   bucket is empty, with a clear error naming the offenders.
3. The gate guarantees a correct starting state — Warehouse at 0, all stock in
   Whatnot — the moment the mode is enabled. From there, every mutating call
   site is responsible for calling a settle/reconcile helper to keep Warehouse
   pinned at 0; this is best-effort maintenance by convention, not a checked
   invariant enforced by the formulas themselves. Missing a call site lets
   Warehouse drift silently (see Risks), so the goal is that turning the split
   back on later needs **no cleanup**, not that the buckets are literally true
   by construction at every instant.
4. No change to the bucket formulas, and no change to any money calculation.

## Out of Scope

- Removing the bucket feature. This hides it; the data model is untouched.
- Any change to Whatnot ledger import, alias mapping, or invoice mechanics.

## Design

### 1. The setting

- New column `app_settings.whatnot_only INTEGER NOT NULL DEFAULT 0`, added by an
  idempotent `PRAGMA table_info` guard in `connection.ts`, following the existing
  pattern used by the invoice display columns.
- Surfaced as `whatnotOnly: boolean` through `getSettings` / `updateSettings`
  (`src/lib/db/settings.ts`), matching the `invoiceShowPhone` boolean handling.
- Rendered as a checkbox in `SettingsForm.tsx` alongside the existing toggles,
  labelled **"Whatnot-only mode — hide Warehouse stock and the Move action"**.

Default is **off**, so existing behavior is unchanged until deliberately enabled.

### 2. The gate

New query `itemsWithWarehouseStock(db)` returns `{ id, name, qty }` for every item
where `warehouseQty !== 0`, **including archived items** — leftover stock in an
archived item is still stock. It catches negatives too: a Warehouse bucket at −2
is as broken a starting point as +12.

The settings route rejects turning the mode **on** while that list is non-empty,
returning **409** with the offending items. `SettingsForm` renders:

> 3 items still have Warehouse stock: Blue Widget (12), Red Gadget (4),
> Old Stock (−2). Move them to Whatnot or adjust them out first.

Turning the mode **off** is never gated — all stock sits in Whatnot, Warehouse is
already 0, and the split simply reappears correct.

### 3. Keeping the buckets honest while on

The bucket formulas in `inventory.ts` are **not modified**. Instead, one helper
keeps reality matching them:

```
settleWhatnotOnly(db, itemId, qty, direction)
```

It writes an `inventory_moves` row noted `auto (Whatnot-only)`, and is a **no-op
when the mode is off**. Three call sites:

| Flow | Entry point | Compensation |
|---|---|---|
| Receiving | `addPurchase` (`purchases.ts:63`) | `to_whatnot` for the received qty, so stock lands in Whatnot |
| Wholesale post | `postInvoice` sale branch (`invoices.ts:123`), at the existing `qtyByItem` loop | `to_warehouse` first, so the existing deduction consumes it and Warehouse returns to 0 |
| Adjustments | `addAdjustment` (`adjustments.ts:12`) | no move — force `channel: 'whatnot'` |

Because the formulas are untouched, the existing invariant test in
`buckets.test.ts` stays valid exactly as written.

Wholesale posting is **not blocked** while the mode is on; it simply draws from
the single pool. The mode is a display preference, not a business rule.

### 4. UI while the mode is on

- `InventoryTable.tsx`: the **Warehouse** and **Whatnot** columns (lines 39–40)
  collapse to a single **In stock** column showing the existing total. The
  oversold red-negative styling goes with them.
- The per-row `MoveStock` button (line 147) is not rendered.
- `AdjustmentsLog.tsx`: the channel picker is hidden and the form posts
  `channel: 'whatnot'`.
- `POST /api/inventory/move` returns **409** while the mode is on, so the server
  enforces the rule rather than trusting a hidden button.
- The Excel backup is unchanged — `inventory_moves` keeps exporting, so no
  history is lost.

## Testing

- Migration adds `whatnot_only` defaulting to 0; running it twice is safe.
- `getSettings`/`updateSettings` round-trip the boolean.
- Gate: rejects with the item list when Warehouse stock exists (including an
  archived item and a negative bucket); allows when all buckets are 0.
- Receiving while on lands the qty in Whatnot, leaving Warehouse at 0.
- Posting a wholesale invoice while on leaves Warehouse at 0 and decreases Whatnot.
- Adjustments while on record `channel: 'whatnot'`.
- `warehouseQty + whatnotQty === qtyRemaining` still holds across all of the above.
- The move API returns 409 while the mode is on.

Verify with `npm test` and `npm run build`, then smoke on a dev copy: enable the
mode with stock present (expect the error), clear it, enable, receive stock, and
confirm the Inventory page shows one column and no Move button.

## Risks

- **Auto-move noise:** the move log gains `auto (Whatnot-only)` rows. Accepted —
  they are the audit trail explaining why the buckets moved.
- **Forgetting a Warehouse-deducting flow** would let Warehouse drift off 0. The
  three call sites above are exhaustive as of this date; the brother path was the
  fourth and is deleted by the prerequisite spec.
- **Turning the mode off leaves auto-moves in place.** Disabling the mode does
  not undo the `auto (Whatnot-only)` moves it generated while on — they are
  ordinary `inventory_moves` rows indistinguishable from a manual Move once
  written. A later reversal of the original flow can then push Warehouse
  negative. Confirmed example: enable → receive 10 (writes `to_whatnot: 10`) →
  disable → delete that purchase batch ⇒ `qtyRemaining: 0`, `warehouseQty: -10`,
  `whatnotQty: +10`. This is the same outcome a manual move would produce in the
  same situation, but here the mode generated the move automatically and
  invisibly, so a user who trials the mode and turns it off is left with these
  compensating moves under every item that received one, with no prompt to
  reconcile or remove them.
