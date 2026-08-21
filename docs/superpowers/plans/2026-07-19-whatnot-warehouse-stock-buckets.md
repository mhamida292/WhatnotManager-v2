# Whatnot vs Warehouse Stock Buckets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split each item's on-hand into a Warehouse bucket and a Whatnot bucket. Received stock lands in Warehouse; a ⇄ Move transfers between buckets; Whatnot ledger sales auto-deduct the Whatnot bucket; wholesale/brother deduct Warehouse; overselling shows a red negative. Fresh start, no migration of existing quantities.

**Architecture:** The buckets are a partition of the existing derived on-hand. Compute `whatnotQty` from events (moves − whatnot sales + whatnot adjustments) and derive `warehouseQty = qtyRemaining − whatnotQty`, so `warehouse + whatnot === qtyRemaining` by construction — profit/COGS/spend math (which use `qtyRemaining`) are untouched. One new event type: **moves**.

**Tech Stack:** TypeScript, Next.js 15, React 19, better-sqlite3, Tailwind, Vitest 2.

## Global Constraints

- **Invariant:** `warehouseQty(item) + whatnotQty(item) === qtyRemaining(item)` for every item, always. Enforced by deriving warehouse from remaining − whatnot.
- Money/quantities are integers. No change to `qtyRemaining`, `qtySold`, cost/COGS/spend.
- Whatnot-channel sales = `qtySoldFromLedger` + `qtySoldByItem` (legacy confirmed show sales). Warehouse-channel = wholesale + brother.
- New `inventory_moves` table via `CREATE TABLE IF NOT EXISTS` in `schema.ts` (no PRAGMA guard needed for a brand-new table). New `channel` column on `inventory_adjustments` via a `PRAGMA table_info`-guarded migration + fresh schema. `NULL` channel = warehouse.
- Overselling/negative buckets are allowed (informational red warning), never blocked.
- Fresh start: new items begin Warehouse 0 / Whatnot 0; no backfill.
- Tests in `tests/**/*.test.ts`; `npx vitest run <path>` for one file.

---

### Task 1: `inventory_moves` table + adjustments `channel` + moves DB module

**Files:**
- Modify: `src/lib/db/schema.ts` (new table + adjustments column)
- Modify: `src/lib/db/connection.ts` (guarded `channel` migration)
- Modify: `src/lib/db/adjustments.ts` (`addAdjustment` accepts `channel`; `sumWhatnotAdjustments`)
- Create: `src/lib/db/moves.ts`
- Test: `tests/lib/db/moves.test.ts`, extend `tests/lib/db/inventory.test.ts` (adjustment channel)

**Interfaces:**
- Produces:
  - `type MoveDirection = "to_whatnot" | "to_warehouse"`
  - `interface Move { id: number; itemId: number; movedOn: string | null; qty: number; direction: MoveDirection; note: string | null }`
  - `addMove(db, { itemId, qty, direction, movedOn?, note? }): number` (qty must be ≥ 1)
  - `listMoves(db, itemId): Move[]`
  - `movedToWhatnot(db, itemId): number`, `movedToWarehouse(db, itemId): number`
  - `addAdjustment` gains optional `channel?: "warehouse" | "whatnot" | null`
  - `sumWhatnotAdjustments(db, itemId): number` (in `adjustments.ts`)

- [ ] **Step 1: Write failing tests**

```ts
// tests/lib/db/moves.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase } from "@/lib/db/inventory";
import { addMove, listMoves, movedToWhatnot, movedToWarehouse } from "@/lib/db/moves";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("inventory moves", () => {
  it("records moves and sums by direction", () => {
    const id = createItemWithFirstPurchase(db, { name: "Widget", lotId: null, purchasedOn: null, quantity: 100, unitCostCents: 100 });
    addMove(db, { itemId: id, qty: 30, direction: "to_whatnot", movedOn: "2026-07-15" });
    addMove(db, { itemId: id, qty: 10, direction: "to_whatnot" });
    addMove(db, { itemId: id, qty: 5, direction: "to_warehouse" });
    expect(movedToWhatnot(db, id)).toBe(40);
    expect(movedToWarehouse(db, id)).toBe(5);
    expect(listMoves(db, id)).toHaveLength(3);
  });
  it("rejects non-positive qty", () => {
    const id = createItemWithFirstPurchase(db, { name: "W", lotId: null, purchasedOn: null, quantity: 1, unitCostCents: 1 });
    expect(() => addMove(db, { itemId: id, qty: 0, direction: "to_whatnot" })).toThrow();
    expect(() => addMove(db, { itemId: id, qty: -3, direction: "to_whatnot" })).toThrow();
  });
});
```

Append to `tests/lib/db/inventory.test.ts` (or a new `tests/lib/db/adjustment-channel.test.ts`):

```ts
import { addAdjustment, sumWhatnotAdjustments, sumAdjustments } from "@/lib/db/adjustments";
// inside a describe with a fresh db + item id:
it("channels: whatnot adjustments sum separately; total sum includes both", () => {
  const db = createDb(":memory:");
  const id = createItemWithFirstPurchase(db, { name: "W", lotId: null, purchasedOn: null, quantity: 10, unitCostCents: 1 });
  addAdjustment(db, { itemId: id, adjustedOn: null, reason: "damage_loss", qty: -2, note: null }); // warehouse (null)
  addAdjustment(db, { itemId: id, adjustedOn: null, reason: "damage_loss", qty: -3, note: null, channel: "whatnot" });
  expect(sumWhatnotAdjustments(db, id)).toBe(-3);
  expect(sumAdjustments(db, id)).toBe(-5); // both channels
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/lib/db/moves.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Schema**

In `src/lib/db/schema.ts`: add `channel TEXT` to the `inventory_adjustments` CREATE TABLE (after `counted INTEGER`), and append a new table:

```sql
CREATE TABLE IF NOT EXISTS inventory_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  moved_on TEXT,
  qty INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('to_whatnot','to_warehouse')),
  note TEXT
);
```

Note: `connection.ts` also has a `db.exec("CREATE TABLE IF NOT EXISTS inventory_adjustments (...)")` fallback in `migrate()`; add `channel TEXT` there too, AND a guarded `ALTER` (Step 4), so both fresh and migrated DBs get the column.

- [ ] **Step 4: Guarded migration for `channel`**

In `src/lib/db/connection.ts` `migrate()`, near the `inventory_adjustments` handling (there is an `acols` check for `counted`), add:

```ts
  if (!acols.includes("channel")) db.exec("ALTER TABLE inventory_adjustments ADD COLUMN channel TEXT");
```

(Reuse the existing `acols` variable computed for the `counted` check — do not redeclare it.)

- [ ] **Step 5: Extend `adjustments.ts`**

Add `channel` to `addAdjustment` and a whatnot-sum helper:

```ts
export function addAdjustment(db: DB, a: { itemId: number; adjustedOn: string | null; reason: AdjustReason; qty: number; note: string | null; counted?: number | null; channel?: "warehouse" | "whatnot" | null }): number {
  const info = db.prepare(
    "INSERT INTO inventory_adjustments (item_id, adjusted_on, reason, qty, note, counted, channel) VALUES (?,?,?,?,?,?,?)"
  ).run(a.itemId, a.adjustedOn, a.reason, a.qty, a.note, a.counted ?? null, a.channel ?? null);
  return Number(info.lastInsertRowid);
}

/** Sum of adjustment qty on the Whatnot channel only. NULL channel counts as warehouse. */
export function sumWhatnotAdjustments(db: DB, itemId: number): number {
  const r = db.prepare("SELECT COALESCE(SUM(qty),0) AS s FROM inventory_adjustments WHERE item_id = ? AND channel = 'whatnot'").get(itemId) as { s: number };
  return Number(r.s);
}
```

(Update the `Adjustment` interface + `listAdjustments` SELECT to include `channel` if you want it surfaced; optional for this task — the derivation only needs `sumWhatnotAdjustments`.)

- [ ] **Step 6: Create `moves.ts`**

```ts
// src/lib/db/moves.ts
import type { DB } from "./connection";

export type MoveDirection = "to_whatnot" | "to_warehouse";
export interface Move {
  id: number; itemId: number; movedOn: string | null; qty: number; direction: MoveDirection; note: string | null;
}

export function addMove(db: DB, m: { itemId: number; qty: number; direction: MoveDirection; movedOn?: string | null; note?: string | null }): number {
  if (!Number.isInteger(m.qty) || m.qty < 1) throw new Error("move qty must be a positive integer");
  const info = db.prepare(
    "INSERT INTO inventory_moves (item_id, moved_on, qty, direction, note) VALUES (?,?,?,?,?)"
  ).run(m.itemId, m.movedOn ?? null, m.qty, m.direction, m.note ?? null);
  return Number(info.lastInsertRowid);
}

export function listMoves(db: DB, itemId: number): Move[] {
  return db.prepare(
    "SELECT id, item_id AS itemId, moved_on AS movedOn, qty, direction, note FROM inventory_moves WHERE item_id = ? ORDER BY moved_on, id"
  ).all(itemId) as Move[];
}

function sumDir(db: DB, itemId: number, direction: MoveDirection): number {
  const r = db.prepare("SELECT COALESCE(SUM(qty),0) AS s FROM inventory_moves WHERE item_id = ? AND direction = ?").get(itemId, direction) as { s: number };
  return Number(r.s);
}
export const movedToWhatnot = (db: DB, itemId: number) => sumDir(db, itemId, "to_whatnot");
export const movedToWarehouse = (db: DB, itemId: number) => sumDir(db, itemId, "to_warehouse");
```

- [ ] **Step 7: Run tests + typecheck + commit**

Run: `npx vitest run tests/lib/db/moves.test.ts tests/lib/db/inventory.test.ts && npx tsc --noEmit` → PASS, clean.

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/adjustments.ts src/lib/db/moves.ts tests/lib/db/moves.test.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): moves table + adjustment channel + moves DB module"
```

---

### Task 2: Bucket derivation (`whatnotQty` / `warehouseQty`)

**Files:**
- Modify: `src/lib/db/inventory.ts`
- Test: `tests/lib/db/buckets.test.ts`

**Interfaces:**
- Produces: `whatnotQty(db, itemId): number`, `warehouseQty(db, itemId): number`.
- Consumes: `qtyRemaining`, `qtySoldFromLedger`, `qtySoldByItem` (this file); `movedToWhatnot`/`movedToWarehouse` (`moves.ts`); `sumWhatnotAdjustments` (`adjustments.ts`).

- [ ] **Step 1: Write failing tests (incl. the invariant)**

```ts
// tests/lib/db/buckets.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, qtyRemaining, whatnotQty, warehouseQty } from "@/lib/db/inventory";
import { addMove } from "@/lib/db/moves";
import { addAdjustment } from "@/lib/db/adjustments";

let db: DB; let id: number;
beforeEach(() => {
  db = createDb(":memory:");
  id = createItemWithFirstPurchase(db, { name: "Booster", lotId: null, purchasedOn: null, quantity: 100, unitCostCents: 100 });
});

describe("stock buckets", () => {
  it("fresh item: all in warehouse, none in whatnot", () => {
    expect(warehouseQty(db, id)).toBe(100);
    expect(whatnotQty(db, id)).toBe(0);
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
  it("move to whatnot shifts the split, total unchanged", () => {
    addMove(db, { itemId: id, qty: 30, direction: "to_whatnot" });
    expect(warehouseQty(db, id)).toBe(70);
    expect(whatnotQty(db, id)).toBe(30);
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
  it("whatnot ledger sale deducts the whatnot bucket", () => {
    addMove(db, { itemId: id, qty: 30, direction: "to_whatnot" });
    // simulate a whatnot sale via alias-mapped ledger row:
    db.prepare("INSERT INTO product_aliases (product_name, item_id) VALUES (?, ?)").run("Booster Pack", id);
    db.prepare("INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key) VALUES ('x','2026-07-15',500,'sale','Booster Pack','k1')").run();
    expect(whatnotQty(db, id)).toBe(29);   // 30 moved − 1 sold
    expect(warehouseQty(db, id)).toBe(70); // unchanged
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
  it("oversell: whatnot goes negative", () => {
    addMove(db, { itemId: id, qty: 1, direction: "to_whatnot" });
    db.prepare("INSERT INTO product_aliases (product_name, item_id) VALUES (?, ?)").run("Booster Pack", id);
    for (const k of ["k1","k2","k3"]) db.prepare("INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key) VALUES ('x','2026-07-15',500,'sale','Booster Pack',?)").run(k);
    expect(whatnotQty(db, id)).toBe(-2); // 1 moved − 3 sold
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
  it("whatnot adjustment reduces the whatnot bucket", () => {
    addMove(db, { itemId: id, qty: 30, direction: "to_whatnot" });
    addAdjustment(db, { itemId: id, adjustedOn: null, reason: "damage_loss", qty: -4, note: null, channel: "whatnot" });
    expect(whatnotQty(db, id)).toBe(26);
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/lib/db/buckets.test.ts`
Expected: FAIL — `whatnotQty`/`warehouseQty` not exported.

- [ ] **Step 3: Implement in `inventory.ts`**

Add imports at the top of `src/lib/db/inventory.ts`:

```ts
import { movedToWhatnot, movedToWarehouse } from "./moves";
import { sumWhatnotAdjustments } from "./adjustments";
```

Add near `qtyRemaining`:

```ts
/** Units currently allocated to Whatnot: moved-in − moved-out − whatnot sales + whatnot adjustments.
 *  May go negative (oversold). Whatnot sales = alias-mapped ledger sales + legacy confirmed show sales. */
export function whatnotQty(db: DB, itemId: number): number {
  const movedIn = movedToWhatnot(db, itemId);
  const movedOut = movedToWarehouse(db, itemId);
  const whatnotSales = qtySoldFromLedger(db, itemId) + qtySoldByItem(db, itemId);
  return movedIn - movedOut - whatnotSales + sumWhatnotAdjustments(db, itemId);
}

/** Units in the Warehouse bucket. Derived as remaining − whatnot so the two buckets
 *  always partition the on-hand exactly (warehouse + whatnot === qtyRemaining). */
export function warehouseQty(db: DB, itemId: number): number {
  return qtyRemaining(db, itemId) - whatnotQty(db, itemId);
}
```

- [ ] **Step 4: Run tests + typecheck + commit**

Run: `npx vitest run tests/lib/db/buckets.test.ts && npx tsc --noEmit` → PASS, clean.

```bash
git add src/lib/db/inventory.ts tests/lib/db/buckets.test.ts
git commit -m "feat(inventory): whatnotQty/warehouseQty bucket derivation (partitions on-hand)"
```

---

### Task 3: Move API route + Move modal

**Files:**
- Create: `src/app/api/inventory/move/route.ts`
- Create: `src/components/inventory/MoveStock.tsx`
- Test: `tests/api/move-stock.test.ts` (DB-layer contract the route wraps)

**Interfaces:**
- Consumes: `addMove` (Task 1); `listItems`.
- Produces: `POST /api/inventory/move` `{ itemId, quantity, direction, movedOn? }` → `{ id }`.

- [ ] **Step 1: Write the failing/contract test**

```ts
// tests/api/move-stock.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, whatnotQty, warehouseQty } from "@/lib/db/inventory";
import { addMove } from "@/lib/db/moves";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("move stock contract", () => {
  it("moving to whatnot updates both buckets", () => {
    const id = createItemWithFirstPurchase(db, { name: "W", lotId: null, purchasedOn: null, quantity: 50, unitCostCents: 100 });
    addMove(db, { itemId: id, qty: 20, direction: "to_whatnot", movedOn: "2026-07-15" });
    expect(whatnotQty(db, id)).toBe(20);
    expect(warehouseQty(db, id)).toBe(30);
  });
});
```

- [ ] **Step 2: Run (passes on existing addMove — locks the contract)**

Run: `npx vitest run tests/api/move-stock.test.ts` → PASS.

- [ ] **Step 3: Create the route**

```ts
// src/app/api/inventory/move/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { addMove } from "@/lib/db/moves";

export async function POST(req: NextRequest) {
  const db = await dbForRequest();
  const body = await req.json();
  const itemId = Number(body.itemId);
  const quantity = Math.trunc(Number(body.quantity));
  const direction = body.direction === "to_warehouse" ? "to_warehouse" : body.direction === "to_whatnot" ? "to_whatnot" : null;
  if (!Number.isInteger(itemId)) return NextResponse.json({ error: "Invalid item" }, { status: 400 });
  if (!(quantity >= 1)) return NextResponse.json({ error: "Quantity must be >= 1" }, { status: 400 });
  if (!direction) return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
  const exists = db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(itemId);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const id = addMove(db, { itemId, quantity: quantity, direction, movedOn: body.movedOn || null } as never);
  return NextResponse.json({ id });
}
```

Note: `addMove` takes `qty` (not `quantity`). Call it correctly:
```ts
  const id = addMove(db, { itemId, qty: quantity, direction, movedOn: body.movedOn || null });
```
(Use this corrected call; drop the `as never`.)

- [ ] **Step 4: Create the MoveStock modal component**

```tsx
// src/components/inventory/MoveStock.tsx
"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function MoveStock({ itemId, itemName, warehouse, whatnot }: { itemId: number; itemName: string; warehouse: number; whatnot: number }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ quantity: "", direction: "to_whatnot", movedOn: today });
  return (
    <>
      <button className="text-brand-700 hover:underline" onClick={() => setOpen(true)} aria-label={`Move ${itemName}`}>⇄ Move</button>
      {open && (
        <Modal title={`Move — ${itemName}`} onClose={() => setOpen(false)}>
          <p className="mb-3 text-sm text-slate-500">Warehouse {warehouse} · Whatnot {whatnot}</p>
          <form className="space-y-2 text-sm max-w-sm" onSubmit={async (e) => {
            e.preventDefault();
            const res = await fetch("/api/inventory/move", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId, quantity: Number(f.quantity), direction: f.direction, movedOn: f.movedOn || null }) });
            if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not move");
          }}>
            <select className={`w-full ${INPUT_CLASS}`} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="to_whatnot">Warehouse → Whatnot</option>
              <option value="to_warehouse">Whatnot → Warehouse</option>
            </select>
            <input className={`w-full ${INPUT_CLASS}`} placeholder="Quantity" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
            <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.movedOn} onChange={(e) => setF({ ...f, movedOn: e.target.value })} />
            <Button type="submit">Move</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `npx vitest run tests/api/move-stock.test.ts && npx tsc --noEmit` → PASS, clean.

```bash
git add src/app/api/inventory/move/route.ts src/components/inventory/MoveStock.tsx tests/api/move-stock.test.ts
git commit -m "feat(inventory): move API + MoveStock modal"
```

---

### Task 4: Inventory table — Warehouse/Whatnot/Total columns + Move + oversold

**Files:**
- Modify: `src/components/InventoryTable.tsx`
- Modify: `src/app/inventory/page.tsx`

**Interfaces:**
- Consumes: `whatnotQty`/`warehouseQty` (Task 2); `MoveStock` (Task 3).

- [ ] **Step 1: Page — compute + pass bucket numbers**

In `src/app/inventory/page.tsx`, import `warehouseQty, whatnotQty` from `@/lib/db/inventory`. In the `items` map, add `warehouse` and `whatnot`:

```ts
  const items = listItems(db).map((i) => ({
    ...i, sold: qtySold(db, i.id), remaining: qtyRemaining(db, i.id),
    warehouse: warehouseQty(db, i.id), whatnot: whatnotQty(db, i.id),
  }));
```

In the `<InventoryTable items={active.map(...)}>` mapping, include `warehouse: i.warehouse, whatnot: i.whatnot` in each row object.

- [ ] **Step 2: Table — columns + Move + oversold styling**

In `src/components/InventoryTable.tsx`:
- Extend the row type with `warehouse: number; whatnot: number;`.
- Add two columns to `COLUMNS` after `qtyPurchased` (keep `remaining` as the Total): a `warehouse` and `whatnot` sortable key (add them to `InvSortKey` too). Keep the existing `remaining` column but relabel it "Total".
- Render the warehouse and whatnot cells; when a bucket value is `< 0`, render it red with a warning title, e.g.:

```tsx
<td className="px-3 py-2">{i.warehouse}</td>
<td className={`px-3 py-2 ${i.whatnot < 0 ? "font-semibold text-red-600" : ""}`} title={i.whatnot < 0 ? "Oversold — sold more on Whatnot than moved in. Move more stock in." : undefined}>
  {i.whatnot}{i.whatnot < 0 ? " ⚠" : ""}
</td>
```

- Add the `⇄ Move` action in the row's action cell (next to Archive), passing `itemId`, `name`, `warehouse`, `whatnot`:

```tsx
<MoveStock itemId={i.id} itemName={i.name} warehouse={i.warehouse} whatnot={i.whatnot} />
```

- Update the "no items" empty-state `colSpan` (currently `COLUMNS.length + 3`) — it already uses `COLUMNS.length`, so adding two COLUMNS keeps it correct; verify it still spans the full width after adding the columns.
- Ensure the sort comparator handles the two new numeric keys (the existing comparator sorts by the key value; numeric keys work as-is).

- [ ] **Step 3: Typecheck + build + full suite**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean; all tests pass; `/inventory` builds.

- [ ] **Step 4: Commit**

```bash
git add src/components/InventoryTable.tsx src/app/inventory/page.tsx
git commit -m "feat(inventory): Warehouse/Whatnot/Total columns, Move action, oversold warning"
```

---

### Task 5: Adjustment channel selector (damage/other)

Let a damage/other adjustment target the Whatnot bucket. Recount/count-sheet stays Warehouse (default).

**Files:**
- Modify: `src/app/api/inventory/[id]/adjustments/route.ts`
- Modify: `src/components/AdjustmentsLog.tsx`

**Interfaces:**
- Consumes: `addAdjustment` `channel` (Task 1).

- [ ] **Step 1: Route accepts channel**

Read `src/app/api/inventory/[id]/adjustments/route.ts`. Where it calls `addAdjustment`, pass a validated channel:

```ts
  const channel = body.channel === "whatnot" ? "whatnot" : "warehouse";
  // ...addAdjustment(db, { ..., channel });
```

(Default "warehouse" when absent/other.)

- [ ] **Step 2: UI — channel select**

In `src/components/AdjustmentsLog.tsx`, add a channel `<select>` (Warehouse / Whatnot, default Warehouse) to the add-adjustment form state and include `channel` in the POST body. Match the form's existing styling.

- [ ] **Step 3: Typecheck + full suite + commit**

Run: `npx tsc --noEmit && npx vitest run` → clean; green.

```bash
git add "src/app/api/inventory/[id]/adjustments/route.ts" src/components/AdjustmentsLog.tsx
git commit -m "feat(inventory): choose Warehouse/Whatnot channel when adjusting stock"
```

---

### Task 6: Verify end-to-end

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build` → all green.

- [ ] **Step 2: Runtime**

Boot an isolated instance (fresh `DATA_DIR`; launch script via `run_in_background`; real `npm install` in the worktree — do NOT symlink node_modules). Create an admin, log in, then via UI/API:
- Create an item, **receive** 100 → Warehouse 100, Whatnot 0, Total 100.
- **⇄ Move** 30 → Whatnot → Warehouse 70, Whatnot 30, Total 100 (unchanged).
- Import/insert a Whatnot ledger sale mapped to the item → Whatnot drops by the sold qty; Warehouse unchanged; Total drops by sold qty. Confirm Warehouse + Whatnot == Total for every item.
- Oversell (sell more than moved-in) → Whatnot shows a red negative with the ⚠ warning.
- Add a **damage adjustment on the Whatnot channel** → Whatnot decreases; Warehouse unchanged.

- [ ] **Step 3: Commit any fixes; branch ready to merge**
