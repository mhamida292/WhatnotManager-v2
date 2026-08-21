# Sweep All Stock to Whatnot — Design

**Date:** 2026-07-28
**Status:** Approved (pending spec review)

## Context

Whatnot-only mode (`2026-07-27-whatnot-only-inventory-toggle-design.md`) can only be
enabled when **every** item's Warehouse bucket is zero — `itemsWithWarehouseStock(db)`
must come back empty, or the settings route returns 409 listing the offenders.

That gate is correct but currently unsatisfiable in practice. Clearing it means
opening the Move modal on every row, one item at a time. With 68 inventory items
that is not a real workflow, so the feature is effectively unreachable.

## Goals

1. One click, from where the block is reported, moves all Warehouse stock to
   Whatnot and turns the mode on.
2. It cannot leave a half-done state — either the stock moved *and* the mode is
   on, or nothing changed.
3. It cannot report success while leaving the gate still blocked.

## Out of Scope

- Sweeping the other way (Whatnot → Warehouse). Wanted eventually when wholesaling
  resumes; not built now.
- Per-item selection or a general bulk-move tool.
- Any change to the gate itself, the bucket formulas, or money math.

## Design

### 1. Where it appears

The 409 response already carries `{ error, items: [{id,name,qty}] }` and
`SettingsForm.tsx:89` already renders that list. Beneath it, a button:

> **Move all Warehouse stock to Whatnot and turn on Whatnot-only mode**

Before running, a confirm states the real scale, computed from the 409 payload:

> This will move 214 units across 68 items from Warehouse to Whatnot, then turn
> on Whatnot-only mode.

One click doing two consequential things is the reason the confirm exists.

### 2. One endpoint, one transaction

`POST /api/inventory/sweep-to-whatnot`, behind the normal auth, does all of this
inside a single `db.transaction`:

1. For every item whose Warehouse bucket is non-zero, write the move that closes it.
2. **Re-check `itemsWithWarehouseStock(db)`. If anything remains, throw** — rolling
   back every move and leaving the mode off.
3. Set `whatnotOnly` on.

Step 2 is the important one: it is a self-check against a stock-mutating path we
have not accounted for. Without it the sweep could report success while the gate
stays blocked, which is the most confusing possible outcome. With it, the failure
mode is an honest error and an unchanged database.

Returns `{ items, units, corrections }` — items swept, total units moved, and how
many items had a negative Warehouse balance that was corrected.

### 3. Reusing the existing arithmetic

`reconcileWhatnotOnly` (`inventory.ts:171-176`) already computes exactly the right
move including its sign, but returns early when the mode is off — which is
precisely when the sweep runs. Rather than duplicate the sign logic:

```ts
/** Write the move that drives this item's Warehouse bucket to 0, whichever
 *  direction that requires. Unconditional — callers decide when it applies. */
export function closeWarehouseBucket(db: DB, itemId: number, note: string): void

/** ...existing doc... A no-op when the mode is off. */
export function reconcileWhatnotOnly(db: DB, itemId: number): void {
  if (!getSettings(db).whatnotOnly) return;
  closeWarehouseBucket(db, itemId, "auto (Whatnot-only)");
}
```

The sweep calls `closeWarehouseBucket(db, id, "sweep to Whatnot")`. One
implementation of the arithmetic, two callers, and `reconcileWhatnotOnly`'s
behavior is unchanged — its existing tests must keep passing untouched.

### 4. Negative buckets

An item at −2 needs 2 units moved *toward* Warehouse to reach zero — the opposite
direction to the button's name. The sweep does this anyway, because leaving it
would keep the gate blocked (`itemsWithWarehouseStock` treats any non-zero bucket,
including negatives, as an offender).

This is reported rather than hidden. When `corrections > 0` the result reads:

> Moved 214 units across 67 items. Corrected 1 item with a negative Warehouse
> balance.

## Testing

- Several items with positive Warehouse stock: all buckets land at 0,
  `whatnotOnly` is on, and `warehouseQty + whatnotQty === qtyRemaining` holds for
  each — asserted explicitly.
- An item with a **negative** Warehouse bucket is corrected to 0 and counted in
  `corrections`.
- **Archived** items are swept too (they block the gate, so they must be).
- A sweep with nothing to move succeeds and simply turns the mode on.
- **Rollback:** if the post-sweep verification fails, no moves persist and
  `whatnotOnly` stays off — asserted against row counts and the setting.
- After a sweep, `itemsWithWarehouseStock(db)` is empty, so saving settings with
  the mode on is no longer rejected.
- `reconcileWhatnotOnly`'s existing tests pass unmodified.

Verify with `npm test` and `npm run build`, then smoke on a dev copy: with stock
present, enable Whatnot-only, get the block, click the sweep button, and confirm
the page comes back in Whatnot-only mode with one "In stock" column.

## Risks

- **Move-log volume.** The sweep writes one `inventory_moves` row per item — 68 in
  the owner's case. Accepted: they are the audit trail for a real inventory change,
  and nothing in the app renders that table today.
- **Irreversible in one step.** There is no "unsweep". Turning the mode back off
  leaves the moves in place (already documented as a risk of the mode itself), so
  the buckets do not return to their prior split. The confirm text is what makes
  this an informed choice.
- **Not atomic with the user's intent, only with the data.** If the sweep succeeds
  the mode is on; the user cannot end up swept-but-off. They can, however, decide
  afterwards that they did not want it — see above.
