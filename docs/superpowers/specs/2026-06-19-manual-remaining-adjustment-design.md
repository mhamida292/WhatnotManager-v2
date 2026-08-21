# Manual "remaining" adjustment — design

**Date:** 2026-06-19

## Problem

Remaining is fully derived: `remaining = qty_purchased − sold − qty_samples`
(`qtyRemaining` in `src/lib/db/inventory.ts:145`). There's no way to correct it
when the real shelf count differs from the derived number — shrinkage, lost or
found units, or a miscount. The user wants to set remaining to the correct value
by hand.

## Goal

Let the user type the exact remaining they know is correct on an item. The app
stores the difference as a persistent signed adjustment. This changes only the
unit count — never cost, COGS, or inventory spend.

## Non-goals

- No effect on `qty_purchased`, cost, or any money figure.
- Not a freeze: the adjustment is a fixed delta, so as more units sell, remaining
  keeps dropping from the corrected baseline (correct behavior).
- Reuse the existing edit surface (`EditItemModal`); no new page.

## Design

New stored column `qty_adjustment` (signed integer, default 0) on
`inventory_items`. Remaining becomes:
```
remaining = qty_purchased − sold − qty_samples + qty_adjustment
```

### Schema — `src/lib/db/schema.ts`
Add to the `inventory_items` CREATE TABLE:
```
  qty_adjustment INTEGER NOT NULL DEFAULT 0,
```
(placed alongside `qty_samples`).

### Migration — `migrate()` in `src/lib/db/connection.ts`
Mirror the existing `qty_samples` idempotent add (connection.ts:20):
```ts
if (!cols.includes("qty_adjustment")) {
  db.exec("ALTER TABLE inventory_items ADD COLUMN qty_adjustment INTEGER NOT NULL DEFAULT 0");
}
```
(`cols` is the existing `PRAGMA table_info(inventory_items)` list.)

### DB layer — `src/lib/db/inventory.ts`
- **`qtyRemaining`** — read `qty_adjustment` and add it:
  ```ts
  const item = db.prepare("SELECT qty_purchased as q, qty_samples as s, qty_adjustment as a FROM inventory_items WHERE id = ?").get(itemId) as any;
  if (!item) return 0;
  return Number(item.q) - qtySold(db, itemId) - Number(item.s) + Number(item.a);
  ```
- **`setItemRemaining(db, id, target)`** — compute and store the delta so that
  remaining equals `target`:
  ```ts
  export function setItemRemaining(db: DB, id: number, target: number): void {
    const item = db.prepare("SELECT qty_purchased as q, qty_samples as s FROM inventory_items WHERE id = ?").get(id) as { q: number; s: number } | undefined;
    if (!item) return;
    const base = Number(item.q) - qtySold(db, id) - Number(item.s);
    db.prepare("UPDATE inventory_items SET qty_adjustment = ? WHERE id = ?").run(target - base, id);
  }
  ```

### API — `src/app/api/inventory/route.ts` (PATCH)
Extend the existing PATCH (which already handles `qtySamples`). Add, after the
`qtySamples` block:
```ts
if (body.targetRemaining !== undefined) {
  const t = Number(body.targetRemaining);
  if (!Number.isInteger(t) || t < 0) return NextResponse.json({ error: "Invalid remaining" }, { status: 400 });
  setItemRemaining(db, id, t);
}
```

### UI — `src/components/EditItemModal.tsx` + `src/components/InventoryTable.tsx`
- `InventoryTable` already renders `EditItemModal` with `initialSamples`; also
  pass `initialRemaining={editing.remaining}`.
- `EditItemModal` gains an `initialRemaining: number` prop and a "Remaining
  (manual count)" number input next to the Samples input, prefilled with
  `initialRemaining`. On blur, PATCH `{ id, targetRemaining: n }` (mirrors
  `saveSamples`), validating `n` is an integer ≥ 0, then `router.refresh()` so
  the table reflects the new remaining.

## Testing (Vitest)

- `setItemRemaining` then `qtyRemaining` returns exactly the target, for an item
  with purchases, sales, and samples (e.g. purchased 10, sold 3, samples 1 → base
  6; set target 4 → adjustment −2 → remaining 4).
- After `setItemRemaining`, recording another sale lowers remaining by one from
  the corrected baseline (proves it's a delta, not a freeze).
- A fresh item (no adjustment) has remaining unchanged from the old formula
  (regression guard: default 0).
- API PATCH: `targetRemaining` of a valid integer updates remaining; negative or
  non-integer → 400; `qtySamples` path still works.

## Risks

- The migration adds a NOT NULL column with a default, so existing rows get 0 —
  no behavior change until the user sets an override. Idempotent guard prevents
  double-add.
