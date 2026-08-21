# Purchase Batches, Edit Modal & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-cost/single-qty inventory model with dated purchase batches (weighted-average cost), expose them through an Edit modal and Add-product modal, and show purchase history on the item detail page.

**Architecture:** A new `item_purchases` table is the source of truth; `inventory_items.qty_purchased` and `unit_cost_cents` become derived values recomputed from the batches on every change, so the existing report/Remaining math is untouched. Inventory spend is computed exactly from the batches. The UI swaps inline editors for modals.

**Tech Stack:** Next.js App Router (server components + route handlers), better-sqlite3, React client components, vitest. Spec: `docs/superpowers/specs/2026-06-15-purchase-batches-and-edit-modal-design.md`.

**Sequencing:** Tasks 1–7 land the data model + wiring (server-only, fully tested and green). Tasks 8–9 add the API. Tasks 10–14 build the UI on top. The app stays green after every task.

---

### Task 1: `item_purchases` table

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add the table to the SCHEMA string**

In `src/lib/db/schema.ts`, add this block inside the `SCHEMA` template literal, immediately after the `inventory_items` table definition (so the referenced table exists first):

```sql
CREATE TABLE IF NOT EXISTS item_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  purchased_on TEXT,
  quantity INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL
);
```

- [ ] **Step 2: Verify the schema loads**

Run: `npx vitest run tests/lib/db/connection.test.ts`
Expected: PASS (the in-memory db builds with the new table).

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(db): item_purchases table (purchase batches)"
```

---

### Task 2: purchases repo — add, list, recompute totals

**Files:**
- Create: `src/lib/db/purchases.ts`
- Test: `tests/lib/db/purchases.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/purchases.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { addPurchase, listPurchases, recomputeItemTotals } from "@/lib/db/purchases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("item purchases", () => {
  it("addPurchase appends a batch and recomputes weighted-average totals", () => {
    const id = insertItem(db, { name: "Butter", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });
    addPurchase(db, { itemId: id, purchasedOn: "2026-06-09", quantity: 12, unitCostCents: 180 });

    const item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
    expect(item.q).toBe(24);
    expect(item.c).toBe(165); // round((12*150 + 12*180) / 24)
  });

  it("listPurchases returns batches oldest first", () => {
    const id = insertItem(db, { name: "Butter", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: "2026-06-09", quantity: 5, unitCostCents: 180 });
    addPurchase(db, { itemId: id, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });
    const rows = listPurchases(db, id);
    expect(rows.map((r) => r.purchasedOn)).toEqual(["2026-03-02", "2026-06-09"]);
    expect(rows[0]).toMatchObject({ quantity: 12, unitCostCents: 150 });
  });

  it("recomputeItemTotals sets totals to zero when there are no batches", () => {
    const id = insertItem(db, { name: "Butter", unitCostCents: 999, qtyPurchased: 7, lotId: null });
    recomputeItemTotals(db, id);
    const item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
    expect(item).toMatchObject({ q: 0, c: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: FAIL — cannot find module `@/lib/db/purchases`.

- [ ] **Step 3: Implement the repo**

Create `src/lib/db/purchases.ts`:

```ts
import type { DB } from "./connection";

export interface Purchase { id: number; itemId: number; purchasedOn: string | null; quantity: number; unitCostCents: number; }

/** Recompute an item's derived totals from its purchase batches:
 *  qty_purchased = sum of quantities, unit_cost_cents = weighted average
 *  (rounded; 0 when there are no units). Keeps the report/Remaining math working. */
export function recomputeItemTotals(db: DB, itemId: number): void {
  const r = db.prepare(
    "SELECT COALESCE(SUM(quantity),0) AS qty, COALESCE(SUM(quantity*unit_cost_cents),0) AS spend FROM item_purchases WHERE item_id = ?"
  ).get(itemId) as { qty: number; spend: number };
  const qty = Number(r.qty);
  const unit = qty > 0 ? Math.round(Number(r.spend) / qty) : 0;
  db.prepare("UPDATE inventory_items SET qty_purchased = ?, unit_cost_cents = ? WHERE id = ?").run(qty, unit, itemId);
}

export function listPurchases(db: DB, itemId: number): Purchase[] {
  return db.prepare(
    "SELECT id, item_id AS itemId, purchased_on AS purchasedOn, quantity, unit_cost_cents AS unitCostCents FROM item_purchases WHERE item_id = ? ORDER BY purchased_on, id"
  ).all(itemId) as Purchase[];
}

/** Record a purchase batch, then recompute the item's derived totals. Atomic. */
export function addPurchase(db: DB, p: { itemId: number; purchasedOn: string | null; quantity: number; unitCostCents: number }): number {
  const tx = db.transaction((p: { itemId: number; purchasedOn: string | null; quantity: number; unitCostCents: number }) => {
    const info = db.prepare(
      "INSERT INTO item_purchases (item_id, purchased_on, quantity, unit_cost_cents) VALUES (?,?,?,?)"
    ).run(p.itemId, p.purchasedOn ?? null, p.quantity, p.unitCostCents);
    recomputeItemTotals(db, p.itemId);
    return Number(info.lastInsertRowid);
  });
  return tx(p);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/purchases.ts tests/lib/db/purchases.test.ts
git commit -m "feat(db): addPurchase/listPurchases + recompute weighted-average totals"
```

---

### Task 3: purchases repo — update & delete

**Files:**
- Modify: `src/lib/db/purchases.ts`
- Test: `tests/lib/db/purchases.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe("item purchases", ...)` block in `tests/lib/db/purchases.test.ts`. Add `updatePurchase, deletePurchase` to the import from `@/lib/db/purchases`.

```ts
it("updatePurchase corrects a batch and recomputes totals", () => {
  const id = insertItem(db, { name: "Butter", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  const pid = addPurchase(db, { itemId: id, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });
  updatePurchase(db, pid, { purchasedOn: "2026-03-02", quantity: 10, unitCostCents: 200 });
  const item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
  expect(item).toMatchObject({ q: 10, c: 200 });
});

it("deletePurchase removes a batch; deleting the last one zeroes totals", () => {
  const id = insertItem(db, { name: "Butter", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  const a = addPurchase(db, { itemId: id, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });
  const b = addPurchase(db, { itemId: id, purchasedOn: "2026-06-09", quantity: 12, unitCostCents: 180 });
  deletePurchase(db, b);
  let item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
  expect(item).toMatchObject({ q: 12, c: 150 });
  deletePurchase(db, a);
  item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
  expect(item).toMatchObject({ q: 0, c: 0 });
  expect(listPurchases(db, id)).toHaveLength(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: FAIL — `updatePurchase is not a function`.

- [ ] **Step 3: Implement update & delete**

Add to `src/lib/db/purchases.ts`:

```ts
/** Edit a batch, then recompute its item's totals. Atomic. */
export function updatePurchase(db: DB, id: number, p: { purchasedOn: string | null; quantity: number; unitCostCents: number }): void {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT item_id AS itemId FROM item_purchases WHERE id = ?").get(id) as { itemId: number } | undefined;
    db.prepare("UPDATE item_purchases SET purchased_on = ?, quantity = ?, unit_cost_cents = ? WHERE id = ?")
      .run(p.purchasedOn ?? null, p.quantity, p.unitCostCents, id);
    if (row) recomputeItemTotals(db, row.itemId);
  });
  tx();
}

/** Delete a batch, then recompute its item's totals. Atomic. */
export function deletePurchase(db: DB, id: number): void {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT item_id AS itemId FROM item_purchases WHERE id = ?").get(id) as { itemId: number } | undefined;
    db.prepare("DELETE FROM item_purchases WHERE id = ?").run(id);
    if (row) recomputeItemTotals(db, row.itemId);
  });
  tx();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/purchases.ts tests/lib/db/purchases.test.ts
git commit -m "feat(db): updatePurchase/deletePurchase with recompute"
```

---

### Task 4: `itemSpendCents` (exact spend)

**Files:**
- Modify: `src/lib/db/purchases.ts`
- Test: `tests/lib/db/purchases.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the describe block; add `itemSpendCents` to the import.

```ts
it("itemSpendCents is the exact sum of batch costs (no rounding drift)", () => {
  const id = insertItem(db, { name: "Odd", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: id, purchasedOn: null, quantity: 3, unitCostCents: 100 });
  addPurchase(db, { itemId: id, purchasedOn: null, quantity: 3, unitCostCents: 101 });
  // avg rounds to 101 (round(603/6)=101) -> avg*qty = 606, but exact spend is 603.
  expect(itemSpendCents(db, id)).toBe(603);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: FAIL — `itemSpendCents is not a function`.

- [ ] **Step 3: Implement**

Add to `src/lib/db/purchases.ts`:

```ts
/** Exact money spent acquiring an item: sum of (quantity * unit cost) over its
 *  batches. Used for the inventory-spend KPI so rounding the average never drifts it. */
export function itemSpendCents(db: DB, itemId: number): number {
  const r = db.prepare("SELECT COALESCE(SUM(quantity*unit_cost_cents),0) AS s FROM item_purchases WHERE item_id = ?").get(itemId) as { s: number };
  return Number(r.s);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/purchases.ts tests/lib/db/purchases.test.ts
git commit -m "feat(db): itemSpendCents — exact per-item spend from batches"
```

---

### Task 5: `createItemWithFirstPurchase`

**Files:**
- Modify: `src/lib/db/inventory.ts`
- Test: `tests/lib/db/purchases.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the describe block in `tests/lib/db/purchases.test.ts`. Add `createItemWithFirstPurchase` to the existing import from `@/lib/db/inventory`.

```ts
it("createItemWithFirstPurchase makes the item and its first batch atomically", () => {
  const id = createItemWithFirstPurchase(db, { name: "Gel", lotId: null, purchasedOn: "2026-06-01", quantity: 10, unitCostCents: 250 });
  const item = db.prepare("SELECT name, qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
  expect(item).toMatchObject({ name: "Gel", q: 10, c: 250 });
  expect(listPurchases(db, id)).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: FAIL — `createItemWithFirstPurchase is not a function`.

- [ ] **Step 3: Implement**

Add to `src/lib/db/inventory.ts`. Add this import near the top (after the existing imports):

```ts
import { addPurchase } from "./purchases";
```

Then add the function (near `insertItem`):

```ts
/** Create a new product together with its first purchase batch, atomically.
 *  qty_purchased / unit_cost_cents are then derived from that batch. */
export function createItemWithFirstPurchase(db: DB, p: { name: string; lotId: number | null; purchasedOn: string | null; quantity: number; unitCostCents: number }): number {
  const tx = db.transaction((p: { name: string; lotId: number | null; purchasedOn: string | null; quantity: number; unitCostCents: number }) => {
    const id = insertItem(db, { name: p.name, unitCostCents: p.unitCostCents, qtyPurchased: 0, lotId: p.lotId });
    addPurchase(db, { itemId: id, purchasedOn: p.purchasedOn, quantity: p.quantity, unitCostCents: p.unitCostCents });
    return id;
  });
  return tx(p);
}
```

(better-sqlite3 supports nested `db.transaction` calls via savepoints, so calling `addPurchase` inside this transaction is fine.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/purchases.test.ts
git commit -m "feat(db): createItemWithFirstPurchase (new product + first batch)"
```

---

### Task 6: Migration backfill for existing items

**Files:**
- Modify: `src/lib/db/connection.ts`
- Test: `tests/lib/db/purchases.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/db/purchases.test.ts`. This simulates a pre-existing item by inserting an `inventory_items` row with scalar totals and no batches, then re-running `migrate`-equivalent logic via a fresh `createDb` won't help (in-memory is per-test). Instead test the exported backfill directly. Add `backfillPurchases` to the import from `@/lib/db/connection`.

```ts
import { backfillPurchases } from "@/lib/db/connection";

it("backfillPurchases seeds one batch per legacy item and is idempotent", () => {
  db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased) VALUES ('Legacy', 150, 12)").run();
  const id = db.prepare("SELECT id FROM inventory_items WHERE name='Legacy'").get() as { id: number };

  backfillPurchases(db);
  let rows = listPurchases(db, id.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ quantity: 12, unitCostCents: 150, purchasedOn: null });

  backfillPurchases(db); // running again must not duplicate
  rows = listPurchases(db, id.id);
  expect(rows).toHaveLength(1);
});

it("backfillPurchases skips items with zero purchased", () => {
  db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased) VALUES ('Empty', 150, 0)").run();
  const id = db.prepare("SELECT id FROM inventory_items WHERE name='Empty'").get() as { id: number };
  backfillPurchases(db);
  expect(listPurchases(db, id.id)).toHaveLength(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: FAIL — `backfillPurchases` is not exported.

- [ ] **Step 3: Implement the backfill and call it from migrate**

In `src/lib/db/connection.ts`, add the exported function and call it at the end of `migrate`:

```ts
/** Seed one purchase batch per item created before item_purchases existed, so the
 *  derived totals reproduce the original scalar qty/cost. Idempotent: items that
 *  already have a batch are skipped; items with no purchased units get none. */
export function backfillPurchases(db: DB): void {
  const items = db.prepare("SELECT id, qty_purchased AS qty, unit_cost_cents AS cost FROM inventory_items WHERE qty_purchased > 0").all() as { id: number; qty: number; cost: number }[];
  const has = db.prepare("SELECT 1 FROM item_purchases WHERE item_id = ? LIMIT 1");
  const insert = db.prepare("INSERT INTO item_purchases (item_id, purchased_on, quantity, unit_cost_cents) VALUES (?, NULL, ?, ?)");
  const tx = db.transaction(() => {
    for (const it of items) {
      if (!has.get(it.id)) insert.run(it.id, it.qty, it.cost);
    }
  });
  tx();
}
```

Then add this line as the last statement inside the existing `migrate(db)` function:

```ts
  backfillPurchases(db);
```

(`SCHEMA` is executed before `migrate` in `createDb`, so `item_purchases` already exists when this runs.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite (nothing else broke)**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/connection.ts tests/lib/db/purchases.test.ts
git commit -m "feat(db): backfill one purchase batch per legacy item (idempotent)"
```

---

### Task 7: Exact inventory spend in dashboard + inventory page

**Files:**
- Modify: `src/lib/calc/dashboard.ts:21`
- Modify: `src/app/inventory/page.tsx`

No new test — `itemSpendCents` is already covered (Task 4); this is a thin wiring swap verified by the existing dashboard tests + build.

- [ ] **Step 1: Switch the dashboard to exact spend**

In `src/lib/calc/dashboard.ts`, add to the imports:

```ts
import { itemSpendCents } from "@/lib/db/purchases";
```

Replace the `itemCosts` line (currently `unit_cost_cents * qty_purchased`):

```ts
  const itemCosts = (db.prepare("SELECT id FROM inventory_items").all() as { id: number }[]).map((r) => itemSpendCents(db, r.id));
```

- [ ] **Step 2: Switch the inventory page Stat to exact spend**

In `src/app/inventory/page.tsx`, add to the imports:

```ts
import { itemSpendCents } from "@/lib/db/purchases";
```

Replace the line `const itemCosts = items.map((i) => i.unitCostCents * i.qtyPurchased);` with:

```ts
  const itemCosts = items.map((i) => itemSpendCents(db, i.id));
```

- [ ] **Step 3: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/calc/dashboard.ts "src/app/inventory/page.tsx"
git commit -m "feat: compute inventory spend exactly from purchase batches"
```

---

### Task 8: `/api/purchases` route

**Files:**
- Create: `src/app/api/purchases/route.ts`

No test (thin route, consistent with the codebase).

- [ ] **Step 1: Create the route**

Create `src/app/api/purchases/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { addPurchase, updatePurchase, deletePurchase } from "@/lib/db/purchases";

const intId = (v: unknown) => Number.isInteger(Number(v));
const qtyOk = (v: unknown) => Number.isInteger(Number(v)) && Number(v) >= 1;
const costOk = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0;
const dateOk = (v: unknown) => v === null || v === undefined || typeof v === "string";

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!intId(b.itemId)) return NextResponse.json({ error: "Invalid itemId" }, { status: 400 });
  if (!qtyOk(b.quantity) || !costOk(b.unitCostCents) || !dateOk(b.purchasedOn))
    return NextResponse.json({ error: "Invalid purchase" }, { status: 400 });
  const id = addPurchase(getDb(), {
    itemId: Number(b.itemId), purchasedOn: b.purchasedOn || null,
    quantity: Math.trunc(Number(b.quantity)), unitCostCents: Math.trunc(Number(b.unitCostCents)),
  });
  return NextResponse.json({ id });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!intId(b.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (!qtyOk(b.quantity) || !costOk(b.unitCostCents) || !dateOk(b.purchasedOn))
    return NextResponse.json({ error: "Invalid purchase" }, { status: 400 });
  updatePurchase(getDb(), Number(b.id), {
    purchasedOn: b.purchasedOn || null,
    quantity: Math.trunc(Number(b.quantity)), unitCostCents: Math.trunc(Number(b.unitCostCents)),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const b = await req.json();
  if (!intId(b.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  deletePurchase(getDb(), Number(b.id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/purchases/route.ts
git commit -m "feat(api): /api/purchases (add/edit/delete batches)"
```

---

### Task 9: New-product POST + drop dead PATCH branches

**Files:**
- Modify: `src/app/api/inventory/route.ts`

No test (thin route).

- [ ] **Step 1: Route new-product creation through `createItemWithFirstPurchase`**

In `src/app/api/inventory/route.ts`, update the import from `@/lib/db/inventory` to add `createItemWithFirstPurchase` and remove `updateItemQty`, `updateItemCost` (no longer used here). It should read:

```ts
import { createItemWithFirstPurchase, deleteItem, insertLot, listItems, qtyRemaining, qtySold, updateItemSamples } from "@/lib/db/inventory";
```

Replace the `POST` handler body so a non-lot create makes the item + first batch:

```ts
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  if (body.kind === "lot") return NextResponse.json({ id: insertLot(db, body) });
  const id = createItemWithFirstPurchase(db, {
    name: body.name, lotId: body.lotId ?? null, purchasedOn: body.purchasedOn || null,
    quantity: Math.trunc(Number(body.quantity)), unitCostCents: Math.trunc(Number(body.unitCostCents)),
  });
  return NextResponse.json({ id });
}
```

- [ ] **Step 2: Remove the now-dead qty/cost PATCH branches**

In the same file's `PATCH` handler, delete the `if (body.qtyPurchased !== undefined) { ... }` and `if (body.unitCostCents !== undefined) { ... }` blocks. Keep only the `qtySamples` branch:

```ts
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = getDb();
  const valid = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0;
  if (body.qtySamples !== undefined) {
    if (!valid(body.qtySamples)) return NextResponse.json({ error: "Invalid qtySamples" }, { status: 400 });
    updateItemSamples(db, id, Math.trunc(Number(body.qtySamples)));
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (If `updateItemQty`/`updateItemCost` are now unused elsewhere, that's fine — they remain exported in `inventory.ts` for tests.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/inventory/route.ts
git commit -m "feat(api): new product creates first batch; drop qty/cost PATCH"
```

---

### Task 10: `Modal` primitive + `PurchaseList`

**Files:**
- Create: `src/components/ui/Modal.tsx`
- Create: `src/components/PurchaseList.tsx`

No test (presentational; consistent with the codebase).

- [ ] **Step 1: Create the Modal primitive**

Create `src/components/ui/Modal.tsx`:

```tsx
"use client";
import { ReactNode } from "react";

/** Centered overlay dialog. Click the backdrop or the ✕ to close. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-12 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create PurchaseList**

Create `src/components/PurchaseList.tsx` (plain component — no `"use client"`, so it renders in both the server detail page and the client modal):

```tsx
import { Money } from "@/components/Money";

export interface PurchaseRow { id: number; purchasedOn: string | null; quantity: number; unitCostCents: number; }

/** Read-only purchase-batch table with a weighted-average + total footer.
 *  Pass onEdit/onDelete to show per-row controls (used inside the Edit modal). */
export function PurchaseList({ purchases, onEdit, onDelete }: {
  purchases: PurchaseRow[];
  onEdit?: (p: PurchaseRow) => void;
  onDelete?: (id: number) => void;
}) {
  const qty = purchases.reduce((s, p) => s + p.quantity, 0);
  const spend = purchases.reduce((s, p) => s + p.quantity * p.unitCostCents, 0);
  const avg = qty > 0 ? Math.round(spend / qty) : 0;
  const editable = !!(onEdit || onDelete);

  if (purchases.length === 0) return <p className="text-sm text-slate-500">No purchases recorded yet.</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-slate-400">
          <th className="py-1">Date</th>
          <th className="py-1 text-right">Qty</th>
          <th className="py-1 text-right">Unit cost</th>
          <th className="py-1 text-right">Total</th>
          {editable && <th className="py-1" />}
        </tr>
      </thead>
      <tbody>
        {purchases.map((p) => (
          <tr key={p.id} className="border-t border-line">
            <td className="py-1.5">{p.purchasedOn ?? "—"}</td>
            <td className="py-1.5 text-right tabular-nums">{p.quantity}</td>
            <td className="py-1.5 text-right tabular-nums"><Money cents={p.unitCostCents} /></td>
            <td className="py-1.5 text-right tabular-nums"><Money cents={p.quantity * p.unitCostCents} /></td>
            {editable && (
              <td className="py-1.5 text-right whitespace-nowrap">
                {onEdit && <button onClick={() => onEdit(p)} className="text-xs text-emerald-700 hover:underline">edit</button>}
                {onDelete && <button onClick={() => onDelete(p.id)} className="ml-2 text-xs text-red-600 hover:underline">✕</button>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-line font-medium">
          <td className="py-1.5 text-slate-500">Purchased {qty}</td>
          <td />
          <td className="py-1.5 text-right text-slate-500">Avg <Money cents={avg} /></td>
          <td className="py-1.5 text-right"><Money cents={spend} /></td>
          {editable && <td />}
        </tr>
      </tfoot>
    </table>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Modal.tsx src/components/PurchaseList.tsx
git commit -m "feat(ui): Modal primitive and PurchaseList table"
```

---

### Task 11: `EditItemModal`

**Files:**
- Create: `src/components/EditItemModal.tsx`

No test (client component).

- [ ] **Step 1: Create the modal**

Create `src/components/EditItemModal.tsx`. It seeds its purchase rows from props (passed down from the server page), mutates via `/api/purchases`, updates local state optimistically, and edits samples via `PATCH /api/inventory`. On close it calls `router.refresh()` so the table totals update.

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { PurchaseList, type PurchaseRow } from "@/components/PurchaseList";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { toCents, toDollars } from "@/lib/money";

const today = () => new Date().toISOString().slice(0, 10);

export function EditItemModal({ itemId, name, initialPurchases, initialSamples, onClose }: {
  itemId: number; name: string; initialPurchases: PurchaseRow[]; initialSamples: number; onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PurchaseRow[]>(initialPurchases);
  const [samples, setSamples] = useState(String(initialSamples));
  const [form, setForm] = useState({ date: today(), qty: "", cost: "" });
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState(false);

  function close() { router.refresh(); onClose(); }

  async function addOrSave() {
    const qty = Math.trunc(Number(form.qty));
    const cents = toCents(Number(form.cost));
    if (!(qty >= 1) || !(cents >= 0)) { setError(true); return; }
    setError(false);
    const body = { id: editing, itemId, purchasedOn: form.date || null, quantity: qty, unitCostCents: cents };
    const res = await fetch("/api/purchases", {
      method: editing == null ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { setError(true); return; }
    if (editing == null) {
      const { id } = await res.json();
      setRows([...rows, { id, purchasedOn: form.date || null, quantity: qty, unitCostCents: cents }]);
    } else {
      setRows(rows.map((r) => r.id === editing ? { ...r, purchasedOn: form.date || null, quantity: qty, unitCostCents: cents } : r));
    }
    setForm({ date: today(), qty: "", cost: "" });
    setEditing(null);
  }

  async function remove(id: number) {
    const res = await fetch("/api/purchases", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (!res.ok) { setError(true); return; }
    setRows(rows.filter((r) => r.id !== id));
  }

  function startEdit(p: PurchaseRow) {
    setEditing(p.id);
    setForm({ date: p.purchasedOn ?? "", qty: String(p.quantity), cost: toDollars(p.unitCostCents).toFixed(2) });
  }

  async function saveSamples(v: string) {
    const n = Math.trunc(Number(v));
    if (!(n >= 0)) return;
    await fetch("/api/inventory", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: itemId, qtySamples: n }),
    });
  }

  return (
    <Modal title={name} onClose={close}>
      <div className="space-y-4">
        <PurchaseList purchases={rows} onEdit={startEdit} onDelete={remove} />

        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{editing == null ? "Add a purchase" : "Edit purchase"}</p>
          <div className="flex flex-wrap items-end gap-2">
            <input type="date" className={INPUT_CLASS} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <input type="number" min="1" placeholder="Qty" className={`w-20 ${INPUT_CLASS}`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            <input type="number" step="0.01" min="0" placeholder="Unit cost $" className={`w-28 ${INPUT_CLASS}`} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            <Button onClick={addOrSave}>{editing == null ? "Add" : "Save"}</Button>
            {editing != null && <Button variant="secondary" onClick={() => { setEditing(null); setForm({ date: today(), qty: "", cost: "" }); }}>Cancel</Button>}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line pt-3 text-sm">
          <label className="text-slate-500">Samples (kept, not for sale):</label>
          <input type="number" min="0" className={`w-20 ${INPUT_CLASS}`} value={samples}
            onChange={(e) => setSamples(e.target.value)} onBlur={(e) => saveSamples(e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600">Something went wrong — check the values and try again.</p>}
        <div className="flex justify-end"><Button variant="secondary" onClick={close}>Done</Button></div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/EditItemModal.tsx
git commit -m "feat(ui): EditItemModal — manage purchases and samples"
```

---

### Task 12: `AddProductModal`

**Files:**
- Create: `src/components/AddProductModal.tsx`

No test (client component).

- [ ] **Step 1: Create the modal**

Create `src/components/AddProductModal.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { toCents } from "@/lib/money";

const today = () => new Date().toISOString().slice(0, 10);

export function AddProductModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", date: today(), qty: "", cost: "" });
  const [error, setError] = useState(false);

  async function add() {
    const qty = Math.trunc(Number(f.qty));
    const cents = toCents(Number(f.cost));
    if (!f.name.trim() || !(qty >= 1) || !(cents >= 0)) { setError(true); return; }
    setError(false);
    const res = await fetch("/api/inventory", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.name.trim(), lotId: null, purchasedOn: f.date || null, quantity: qty, unitCostCents: cents }),
    });
    if (!res.ok) { setError(true); return; }
    router.refresh();
    onClose();
  }

  return (
    <Modal title="Add product" onClose={onClose}>
      <div className="space-y-3">
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <p className="text-xs font-semibold uppercase text-slate-500">First purchase</p>
        <div className="flex flex-wrap items-end gap-2">
          <input type="date" className={INPUT_CLASS} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <input type="number" min="1" placeholder="Qty" className={`w-20 ${INPUT_CLASS}`} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          <input type="number" step="0.01" min="0" placeholder="Unit cost $" className={`w-28 ${INPUT_CLASS}`} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
        </div>
        {error && <p className="text-sm text-red-600">Enter a name, a quantity ≥ 1, and a cost.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={add}>Add product</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AddProductModal.tsx
git commit -m "feat(ui): AddProductModal — new product + first purchase"
```

---

### Task 13: Inventory table refactor + page wiring + remove Add-item card

**Files:**
- Modify: `src/components/InventoryTable.tsx`
- Modify: `src/app/inventory/page.tsx`
- Modify: `src/components/InventoryForms.tsx`

No test (UI).

- [ ] **Step 1: Pass purchases + samples into the table from the server page**

In `src/app/inventory/page.tsx`, add to imports:

```ts
import { listPurchases } from "@/lib/db/purchases";
```

Change the `InventoryTable` invocation to include each item's purchases (the `PurchaseRow` shape matches `listPurchases`’ output):

```tsx
      <InventoryTable items={items.map((i) => ({
        id: i.id, name: i.name, unitCostCents: i.unitCostCents,
        qtyPurchased: i.qtyPurchased, qtySamples: i.qtySamples, sold: i.sold, remaining: i.remaining,
        purchases: listPurchases(db, i.id).map((p) => ({ id: p.id, purchasedOn: p.purchasedOn, quantity: p.quantity, unitCostCents: p.unitCostCents })),
      }))} />
```

- [ ] **Step 2: Refactor the table to read-only values + Edit button + Add product**

Rewrite `src/components/InventoryTable.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { Money } from "@/components/Money";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EditItemModal } from "@/components/EditItemModal";
import { AddProductModal } from "@/components/AddProductModal";
import type { PurchaseRow } from "@/components/PurchaseList";
import { stockBadge } from "@/lib/calc/stock-status";
import { sortInventory, type InvSortKey, type SortDir } from "@/lib/ui/sort-inventory";

export interface InventoryRow {
  id: number;
  name: string;
  unitCostCents: number;
  qtyPurchased: number;
  qtySamples: number;
  sold: number;
  remaining: number;
  purchases: PurchaseRow[];
}

const COLUMNS: { key: InvSortKey; label: string }[] = [
  { key: "name", label: "Item" },
  { key: "unitCostCents", label: "Avg cost" },
  { key: "qtyPurchased", label: "Purchased" },
  { key: "sold", label: "Sold" },
  { key: "qtySamples", label: "Samples" },
  { key: "remaining", label: "Remaining" },
];

export function InventoryTable({ items }: { items: InventoryRow[] }) {
  const [key, setKey] = useState<InvSortKey>("name");
  const [dir, setDir] = useState<SortDir>("asc");
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const [adding, setAdding] = useState(false);

  const onSort = (k: InvSortKey) => {
    if (k === key) setDir(dir === "asc" ? "desc" : "asc");
    else { setKey(k); setDir(k === "name" ? "asc" : "desc"); }
  };

  const sorted = sortInventory(items, key, dir);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>+ Add product</Button>
      </div>

      <DataTable head={<>
        {COLUMNS.map((c) => (
          <th key={c.key} className="cursor-pointer select-none px-3 py-2 hover:text-slate-700" onClick={() => onSort(c.key)}>
            {c.label}
            <span className="ml-1 text-slate-400">{key === c.key ? (dir === "asc" ? "▲" : "▼") : ""}</span>
          </th>
        ))}
        <th className="px-3 py-2" />
      </>}>
        {sorted.map((i) => {
          const badge = stockBadge(i.remaining);
          return (
            <tr key={i.id} className="border-t border-line">
              <td className="px-3 py-2">
                <Link href={`/inventory/${i.id}`} className="font-medium text-emerald-700 hover:underline">{i.name}</Link>
                {badge && (
                  <span className="ml-2 align-middle">
                    <Badge variant={i.remaining <= 0 ? "red" : "amber"}>{badge.label}</Badge>
                  </span>
                )}
              </td>
              <td className="px-3 py-2"><Money cents={i.unitCostCents} /></td>
              <td className="px-3 py-2">{i.qtyPurchased}</td>
              <td className="px-3 py-2">{i.sold}</td>
              <td className="px-3 py-2">{i.qtySamples}</td>
              <td className="px-3 py-2">{i.remaining}</td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => setEditing(i)} className="text-sm font-medium text-emerald-700 hover:underline">Edit</button>
              </td>
            </tr>
          );
        })}
      </DataTable>

      {editing && (
        <EditItemModal itemId={editing.id} name={editing.name} initialPurchases={editing.purchases}
          initialSamples={editing.qtySamples} onClose={() => setEditing(null)} />
      )}
      {adding && <AddProductModal onClose={() => setAdding(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: Remove the "Add item" card from InventoryForms**

In `src/components/InventoryForms.tsx`, delete the entire `<Card title="Add item">…</Card>` block (the first card and its form), and the now-unused `item`/`setItem` state line. Change the outer grid from `sm:grid-cols-3` to `sm:grid-cols-2` so the two remaining cards (Map, Brother) lay out cleanly. Leave everything else untouched.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. (`Money`/`EditableCost`/`EditableQty` imports are gone from the table; that's expected.)

- [ ] **Step 5: Commit**

```bash
git add src/components/InventoryTable.tsx "src/app/inventory/page.tsx" src/components/InventoryForms.tsx
git commit -m "feat(ui): inventory table uses Edit/Add-product modals; drop inline editors"
```

---

### Task 14: Detail-page purchase history + retire inline editors + sweep

**Files:**
- Modify: `src/app/inventory/[id]/page.tsx`
- Delete: `src/components/EditableCost.tsx`, `src/components/EditableQty.tsx`

- [ ] **Step 1: Add a Purchases card to the detail page**

In `src/app/inventory/[id]/page.tsx`, add to imports:

```ts
import { listPurchases } from "@/lib/db/purchases";
import { PurchaseList } from "@/components/PurchaseList";
import { Card } from "@/components/ui/Card";
```

(`Card` may already be imported — if so, don't duplicate it.)

After the existing `const sales = ledgerSalesForItem(db, itemId);` line, add:

```tsx
  const purchases = listPurchases(db, itemId).map((p) => ({ id: p.id, purchasedOn: p.purchasedOn, quantity: p.quantity, unitCostCents: p.unitCostCents }));
```

Then, in the returned JSX, immediately before the `<div>` that contains the `<h2>…Ledger sales…</h2>` block, add:

```tsx
      <Card title={`Purchases (${purchases.length})`}>
        <PurchaseList purchases={purchases} />
      </Card>
```

- [ ] **Step 2: Delete the retired inline editors**

```bash
git rm src/components/EditableCost.tsx src/components/EditableQty.tsx
```

- [ ] **Step 3: Confirm nothing references them**

Run: `grep -rn "EditableCost\|EditableQty" src` — expect no matches.
Run: `npx tsc --noEmit` — expect no errors.

- [ ] **Step 4: Full verification sweep**

Run: `npx vitest run`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add "src/app/inventory/[id]/page.tsx"
git commit -m "feat(inventory): purchase history on detail page; retire inline editors"
```
