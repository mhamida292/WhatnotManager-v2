# Sweep All Stock to Whatnot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click, from the block message that stops you enabling Whatnot-only mode, moves all Warehouse stock into Whatnot and turns the mode on — atomically.

**Architecture:** Extract the sign arithmetic already inside `reconcileWhatnotOnly` into an unconditional `closeWarehouseBucket` helper, so the sweep and the reconciler share one implementation. A new endpoint runs the sweep, re-verifies the gate is satisfied, and flips the setting — all in one transaction, so a failure leaves nothing changed.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest (node env, no React Testing Library), Tailwind.

## Global Constraints

- Work on branch `feat/sweep-to-whatnot`. Never commit to `main`.
- **Never read, write or delete anything under `data/`** — it holds the owner's real databases. Tests use `:memory:` or a scratch `DATA_DIR`.
- **Never modify `warehouseQty` or `whatnotQty`.** `tests/lib/db/buckets.test.ts` must keep passing unmodified, and `warehouseQty + whatnotQty === qtyRemaining` must hold after every sweep.
- `reconcileWhatnotOnly`'s observable behavior must not change — its existing tests (`tests/lib/db/whatnot-only-reconcile.test.ts`) must pass **unmodified**.
- The sweep and the setting flip are **one transaction**. A failure rolls back both.
- No money math changes.
- Run `npm test` before every commit. Run `npm run build` before the final commit.

---

## File Structure

**Modified:**
- `src/lib/db/inventory.ts` — extract `closeWarehouseBucket`; `reconcileWhatnotOnly` delegates to it; add `sweepWarehouseToWhatnot`
- `src/components/SettingsForm.tsx` — the button, its confirm, and the result message

**Created:**
- `src/app/api/inventory/sweep-to-whatnot/route.ts`
- `tests/lib/db/sweep-to-whatnot.test.ts`

---

### Task 1: Extract `closeWarehouseBucket`

Pure refactor. No behavior changes anywhere.

**Files:**
- Modify: `src/lib/db/inventory.ts:171-176`

**Interfaces:**
- Produces: `closeWarehouseBucket(db: DB, itemId: number, note: string): number` — writes the move that drives this item's Warehouse bucket to 0, whichever direction that needs, and **returns the signed bucket value it closed** (positive = moved to Whatnot, negative = corrected, 0 = nothing written). Task 2 uses that return value to count units and corrections.

- [ ] **Step 1: Extract the helper**

In `src/lib/db/inventory.ts`, replace the body of `reconcileWhatnotOnly` and add the helper above it:

```ts
/** Write the move that drives this item's Warehouse bucket to 0, whichever
 *  direction that requires. Unconditional — callers decide when it applies.
 *  Returns the signed bucket value that was closed: positive means units moved
 *  to Whatnot, negative means a negative balance was corrected, 0 means no move
 *  was needed and none was written. */
export function closeWarehouseBucket(db: DB, itemId: number, note: string): number {
  const w = warehouseQty(db, itemId);
  if (w > 0) addMove(db, { itemId, qty: w, direction: "to_whatnot", note });
  else if (w < 0) addMove(db, { itemId, qty: -w, direction: "to_warehouse", note });
  return w;
}
```

Then `reconcileWhatnotOnly` keeps its existing doc comment and becomes:

```ts
export function reconcileWhatnotOnly(db: DB, itemId: number): void {
  if (!getSettings(db).whatnotOnly) return;
  closeWarehouseBucket(db, itemId, "auto (Whatnot-only)");
}
```

The note string `"auto (Whatnot-only)"` must stay byte-identical — existing tests and the move log depend on it.

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: PASS with **no test file modified**. `tests/lib/db/whatnot-only-reconcile.test.ts` passing untouched is the proof this refactor changed nothing observable. If it fails, the extraction is wrong — fix the code, never the test.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/inventory.ts
git commit -m "refactor(inventory): extract closeWarehouseBucket from reconcileWhatnotOnly"
```

---

### Task 2: `sweepWarehouseToWhatnot`

**Files:**
- Modify: `src/lib/db/inventory.ts`
- Test: `tests/lib/db/sweep-to-whatnot.test.ts` (create)

**Interfaces:**
- Consumes: `closeWarehouseBucket` (Task 1), `itemsWithWarehouseStock`, `getSettings`/`updateSettings`.
- Produces: `sweepWarehouseToWhatnot(db: DB): { items: number; units: number; corrections: number }` — sweeps every non-zero Warehouse bucket, verifies the gate is then satisfied, and turns `whatnotOnly` on. All in one transaction. Task 3's route returns this object as JSON.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/db/sweep-to-whatnot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import {
  insertItem, itemsWithWarehouseStock, qtyRemaining,
  sweepWarehouseToWhatnot, warehouseQty, whatnotQty,
} from "@/lib/db/inventory";
import { addMove } from "@/lib/db/moves";
import { getSettings } from "@/lib/db/settings";

function partitionHolds(db: any, id: number) {
  expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
}

describe("sweepWarehouseToWhatnot", () => {
  it("moves every item's warehouse stock to whatnot and turns the mode on", () => {
    const db = createDb(":memory:");
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 4, lotId: null });

    const res = sweepWarehouseToWhatnot(db);

    expect(res).toEqual({ items: 2, units: 14, corrections: 0 });
    expect(warehouseQty(db, a)).toBe(0);
    expect(warehouseQty(db, b)).toBe(0);
    expect(whatnotQty(db, a)).toBe(10);
    expect(whatnotQty(db, b)).toBe(4);
    expect(getSettings(db).whatnotOnly).toBe(true);
    expect(itemsWithWarehouseStock(db)).toEqual([]);
    partitionHolds(db, a);
    partitionHolds(db, b);
  });

  it("corrects a negative warehouse bucket and counts it", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Oversold", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addMove(db, { itemId: id, qty: 2, direction: "to_whatnot" }); // warehouse -> -2

    const res = sweepWarehouseToWhatnot(db);

    expect(res.corrections).toBe(1);
    expect(warehouseQty(db, id)).toBe(0);
    expect(itemsWithWarehouseStock(db)).toEqual([]);
    partitionHolds(db, id);
  });

  it("sweeps archived items too", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Old", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    db.prepare("UPDATE inventory_items SET archived_at = '2026-01-01' WHERE id = ?").run(id);

    sweepWarehouseToWhatnot(db);

    expect(warehouseQty(db, id)).toBe(0);
    expect(itemsWithWarehouseStock(db)).toEqual([]);
  });

  it("succeeds with nothing to move and just enables the mode", () => {
    const db = createDb(":memory:");
    const res = sweepWarehouseToWhatnot(db);
    expect(res).toEqual({ items: 0, units: 0, corrections: 0 });
    expect(getSettings(db).whatnotOnly).toBe(true);
  });

  it("writes exactly one move row per swept item", () => {
    const db = createDb(":memory:");
    insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 4, lotId: null });
    insertItem(db, { name: "Empty", unitCostCents: 100, qtyPurchased: 0, lotId: null });

    sweepWarehouseToWhatnot(db);

    expect((db.prepare("SELECT COUNT(*) AS c FROM inventory_moves").get() as any).c).toBe(2);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/lib/db/sweep-to-whatnot.test.ts`
Expected: FAIL — `sweepWarehouseToWhatnot` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/db/inventory.ts`, after `itemsWithWarehouseStock`:

```ts
/** Move every item's Warehouse stock into Whatnot and turn Whatnot-only mode on,
 *  atomically. Verifies the gate is actually satisfied before flipping the
 *  setting, so a stock-mutating path we haven't accounted for surfaces as a
 *  rolled-back error rather than a "success" that leaves the mode unreachable. */
export function sweepWarehouseToWhatnot(db: DB): { items: number; units: number; corrections: number } {
  const tx = db.transaction(() => {
    let items = 0, units = 0, corrections = 0;
    for (const { id } of itemsWithWarehouseStock(db)) {
      const closed = closeWarehouseBucket(db, id, "sweep to Whatnot");
      if (closed === 0) continue;
      items += 1;
      if (closed > 0) units += closed;
      else corrections += 1;
    }
    const left = itemsWithWarehouseStock(db);
    if (left.length > 0) {
      throw new Error(`Sweep left ${left.length} item(s) with Warehouse stock; nothing was changed`);
    }
    updateSettings(db, { ...getSettings(db), whatnotOnly: true });
    return { items, units, corrections };
  });
  return tx();
}
```

Import `updateSettings` alongside the existing `getSettings` import if it is not already imported.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, including `tests/lib/db/buckets.test.ts` and `tests/lib/db/whatnot-only-reconcile.test.ts` **unmodified**.

- [ ] **Step 5: Add the rollback test**

The verification branch needs coverage, and it cannot be reached through normal data. Add a test that proves rollback by making the verification fail — e.g. temporarily stub or spy so a bucket remains non-zero, or insert a row mid-transaction. If you cannot provoke it without contorting the code, say so in your report and instead assert the weaker but real property: **when the transaction throws, no `inventory_moves` rows persist and `whatnotOnly` stays false.** Do not delete the requirement silently.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/inventory.ts tests/
git commit -m "feat(inventory): sweepWarehouseToWhatnot moves all stock and enables the mode"
```

---

### Task 3: The endpoint and the button

**Files:**
- Create: `src/app/api/inventory/sweep-to-whatnot/route.ts`
- Modify: `src/components/SettingsForm.tsx`

**Interfaces:**
- Consumes: `sweepWarehouseToWhatnot` (Task 2), and the 409 payload `{ error, items: [{id,name,qty}] }` the settings route already returns.

- [ ] **Step 1: Create the route**

`src/app/api/inventory/sweep-to-whatnot/route.ts`, mirroring the shape of `src/app/api/inventory/move/route.ts`:

```ts
import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { sweepWarehouseToWhatnot } from "@/lib/db/inventory";

export async function POST() {
  try {
    return NextResponse.json(sweepWarehouseToWhatnot(await dbForRequest()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Keep the blocking items in state**

`SettingsForm.tsx` currently formats the 409 body straight into the `gateError` string and discards the array. Keep the items too — add a `blockers` state holding `{id,name,qty}[]`, set it in the 409 branch alongside `gateError`, and clear it on a successful save.

- [ ] **Step 3: Render the button**

Beneath the `gateError` line (currently `SettingsForm.tsx:89`), when `blockers.length > 0`, render a button labelled **"Move all Warehouse stock to Whatnot and turn on Whatnot-only mode"**. On click:

```ts
    const units = blockers.reduce((sum, b) => sum + Math.max(0, b.qty), 0);
    if (!confirm(`This will move ${units} units across ${blockers.length} items from Warehouse to Whatnot, then turn on Whatnot-only mode.\n\nContinue?`)) return;
    const res = await fetch("/api/inventory/sweep-to-whatnot", { method: "POST" });
    const data = await res.json();
    if (!res.ok) { setGateError(data.error ?? "Sweep failed."); return; }
    let text = `Moved ${data.units} units across ${data.items} items.`;
    if (data.corrections > 0) {
      text += ` Corrected ${data.corrections} item${data.corrections === 1 ? "" : "s"} with a negative Warehouse balance.`;
    }
    setGateError(null);
    setBlockers([]);
    setWhatnotOnly(true);
    setMsg(text);      // use whatever success-message state this form already has
    router.refresh();  // add the useRouter import if the component doesn't have one
```

Match the component's existing conventions for buttons, success text and refresh — read it first and follow what is there rather than introducing a new pattern.

- [ ] **Step 4: Build and test**

Run: `npm test` then `npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat(settings): one-click sweep of Warehouse stock from the gate error"
```

---

### Task 4: Verification and smoke

- [ ] **Step 1:** Run `npm test` — Expected: PASS, with `buckets.test.ts` and `whatnot-only-reconcile.test.ts` unmodified.
- [ ] **Step 2:** Run `npm run build` — Expected: succeeds.
- [ ] **Step 3:** Confirm the repo's `data/` is untouched — `git status` clean, and the four `data/ws/*.db` md5s unchanged from the values recorded at the start of the task.
- [ ] **Step 4: Smoke on a dev copy.** Copy `data/` to a scratch directory, run `DATA_DIR=<copy> npx next dev -p 3010`, and log in. With stock present, tick Whatnot-only and Save — confirm the block lists items. Click the sweep button, accept the confirm, and confirm: the page returns in Whatnot-only mode with a single "In stock" column, no Move button, and the reported counts match what the block listed. Confirm no dev-server console errors.
- [ ] **Step 5:** In the scratch copy, confirm `inventory_moves` gained exactly one row per swept item, each noted `sweep to Whatnot`.
- [ ] **Step 6: Final commit** only if fixups were needed.

---

## Self-Review

**Spec coverage:** §1 where it appears → Task 3. §2 endpoint/transaction/verification → Tasks 2 and 3. §3 reusing the arithmetic → Task 1. §4 negative buckets → Task 2 (`corrections`) and Task 3 (the message). Testing section → Tasks 2 and 4.

**Ordering rationale:** the refactor lands first and must change nothing observable, proven by the reconcile tests passing untouched — so any later failure is attributable to new code, not the extraction.

**Known risks:** (1) The verification-failure branch is hard to provoke honestly; Task 2 Step 5 says to report rather than silently drop it. (2) `SettingsForm.tsx` may not currently import `useRouter` or have a success-message state distinct from `saved` — Task 3 Step 3 tells the implementer to follow the file's existing conventions instead of assuming. (3) `units` in the confirm counts only positive balances, so an item at −2 contributes 0 to the pre-count but still appears in the item tally; the post-sweep message reports corrections separately, which is the honest split.

## Port note (after completion)

Add to `docs/PORT-TO-WHATNOT-MANAGER.md` as part of Feature 10 (Whatnot-only mode) rather than as a new feature — it is the control that makes that feature's gate usable, and porting the gate without it repeats the same dead end.
