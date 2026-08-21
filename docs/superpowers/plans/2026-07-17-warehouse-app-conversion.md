# Warehouse App Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the copied Whatnot Business Manager into a single-business warehouse app: one shared dataset, inventory locations + receiving, a simple payroll module, and expense reimbursement tracking, while keeping the Whatnot aggregator intact.

**Architecture:** Next.js 15 App Router + better-sqlite3, money as integer cents. All existing modules stay; we add columns/tables via the established idempotent `migrate()` guard pattern, add DB-layer helpers mirroring `src/lib/db/expenses.ts`, and add pages/API routes following existing conventions. The one structural change is routing every logged-in request to a single shared workspace DB instead of a per-user DB.

**Tech Stack:** TypeScript, Next.js 15, React 19, better-sqlite3 12, Tailwind 3, Vitest 2.

## Global Constraints

- Money is stored and passed as **integer cents** everywhere; field names end in `_cents` (DB) / `Cents` (TS). Copied verbatim from existing code.
- People are **free-text names** — no roster table, no foreign keys to users.
- All schema changes are **additive and idempotent**, guarded by `PRAGMA table_info(<table>)` checks inside `migrate()` in `src/lib/db/connection.ts`, matching the existing style.
- DB-layer modules export plain functions taking `db: DB` as the first arg; tests use `createDb(":memory:")` in `beforeEach`.
- Tests live in `tests/**/*.test.ts`, run with `npm test` (Vitest, `environment: "node"`, `@` alias → `src`).
- Do not add automatic warehouse stock deduction for Whatnot sales; the alias/item link stays informational.

---

### Task 1: Shared workspace access model

Route every authenticated request to one shared DB (`data/ws/0.db`) instead of `data/ws/<userId>.db`. Login/registry/admin gating unchanged.

**Files:**
- Modify: `src/lib/db/connection.ts` (add `SHARED_WORKSPACE_ID` export)
- Modify: `src/lib/auth/request.ts:29` (`dbForRequest`)
- Modify: `src/app/api/setup/route.ts:14-15` (adopt legacy into shared id)
- Test: `tests/lib/db/shared-workspace.test.ts`

**Interfaces:**
- Produces: `SHARED_WORKSPACE_ID` constant (= `0`) exported from `src/lib/db/connection.ts`.
- Consumes: existing `getDb(userId)`, `adoptLegacyDb(userId)`, `workspacePath(userId)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/db/shared-workspace.test.ts
import { describe, it, expect } from "vitest";
import { SHARED_WORKSPACE_ID, workspacePath } from "@/lib/db/connection";

describe("shared workspace", () => {
  it("exposes a fixed shared workspace id of 0", () => {
    expect(SHARED_WORKSPACE_ID).toBe(0);
  });
  it("maps the shared id to a single ws/0.db path", () => {
    expect(workspacePath(SHARED_WORKSPACE_ID).endsWith("/ws/0.db")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/shared-workspace.test.ts`
Expected: FAIL — `SHARED_WORKSPACE_ID` is not exported.

- [ ] **Step 3: Add the constant in `connection.ts`**

Add near the top of `src/lib/db/connection.ts`, after the `export type DB` line:

```ts
/** Single shared business workspace. Every logged-in user reads/writes this one
 *  DB (data/ws/0.db); login only gates access, it no longer isolates data. */
export const SHARED_WORKSPACE_ID = 0;
```

- [ ] **Step 4: Point `dbForRequest` at the shared workspace**

In `src/lib/auth/request.ts`, update the import and function:

```ts
import { getDb, SHARED_WORKSPACE_ID, type DB } from "@/lib/db/connection";
// ...
export async function dbForRequest(): Promise<DB> {
  await requireUser();            // still require a valid login
  return getDb(SHARED_WORKSPACE_ID);
}
```

- [ ] **Step 5: Adopt legacy data into the shared workspace on setup**

In `src/app/api/setup/route.ts`, change lines 14-15 so legacy `whatnot.db` is adopted as the shared DB (not the admin's per-user DB):

```ts
import { adoptLegacyDb, getDb, SHARED_WORKSPACE_ID } from "@/lib/db/connection";
// ... after creating the admin user `id`:
adoptLegacyDb(SHARED_WORKSPACE_ID); // bring data/whatnot.db forward as the shared workspace, if present
getDb(SHARED_WORKSPACE_ID);         // ensure the shared workspace file exists (fresh if no legacy)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib/db/shared-workspace.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/connection.ts src/lib/auth/request.ts src/app/api/setup/route.ts tests/lib/db/shared-workspace.test.ts
git commit -m "feat(access): route all logins to one shared workspace DB"
```

---

### Task 2: Inventory location column + DB layer

Add a nullable `location` field to items, readable/writable via the DB layer.

**Files:**
- Modify: `src/lib/db/connection.ts` (migration in `migrate()`)
- Modify: `src/lib/db/schema.ts` (add column to fresh schema)
- Modify: `src/lib/db/inventory.ts` (`ItemRow`, `listItems`, new `setItemLocation`)
- Test: `tests/lib/db/inventory-location.test.ts`

**Interfaces:**
- Produces: `ItemRow.location: string | null`; `setItemLocation(db, id, location: string | null): void`.
- Consumes: existing `createItemWithFirstPurchase`, `listItems`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/db/inventory-location.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, listItems, setItemLocation } from "@/lib/db/inventory";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("inventory location", () => {
  it("defaults location to null and can set it", () => {
    const id = createItemWithFirstPurchase(db, { name: "Widget", lotId: null, purchasedOn: null, quantity: 5, unitCostCents: 100 });
    expect(listItems(db).find((i) => i.id === id)?.location).toBeNull();
    setItemLocation(db, id, "A3-2");
    expect(listItems(db).find((i) => i.id === id)?.location).toBe("A3-2");
    setItemLocation(db, id, null);
    expect(listItems(db).find((i) => i.id === id)?.location).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/inventory-location.test.ts`
Expected: FAIL — `setItemLocation` not exported / `location` undefined.

- [ ] **Step 3: Add `location` to the fresh schema**

In `src/lib/db/schema.ts`, in the `inventory_items` table definition, add a column after `archived_at TEXT`:

```sql
  archived_at TEXT,
  location TEXT
```

- [ ] **Step 4: Add the idempotent migration**

In `src/lib/db/connection.ts` `migrate()`, in the block that checks `inventory_items` columns (the `cols` variable already exists there), add:

```ts
  if (!cols.includes("location")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN location TEXT");
  }
```

- [ ] **Step 5: Extend the DB layer**

In `src/lib/db/inventory.ts`, update `ItemRow` and `listItems`, and add `setItemLocation`:

```ts
export interface ItemRow { id: number; name: string; unitCostCents: number; qtyPurchased: number; lotId: number | null; archivedAt: string | null; location: string | null; }
```

In `listItems`, add `location` to the SELECT (keep existing columns/aliases):

```ts
export function listItems(db: DB): ItemRow[] {
  return db.prepare(
    `SELECT id, name, unit_cost_cents AS unitCostCents, qty_purchased AS qtyPurchased,
     lot_id AS lotId, archived_at AS archivedAt, location FROM inventory_items ORDER BY name`
  ).all() as ItemRow[];
}
```

(Match the existing `listItems` body — only add `location` to the column list and the interface. If the existing query filters archived rows or orders differently, preserve that; just append `, location`.)

Add at the end of the file:

```ts
/** Set (or clear, with null) an item's physical warehouse location. */
export function setItemLocation(db: DB, id: number, location: string | null): void {
  db.prepare("UPDATE inventory_items SET location = ? WHERE id = ?").run(location?.trim() || null, id);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib/db/inventory-location.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full inventory test suite (no regressions)**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/inventory.ts tests/lib/db/inventory-location.test.ts
git commit -m "feat(inventory): add location field with DB layer"
```

---

### Task 3: Inventory location in UI (table + edit)

Surface `location` in the inventory table and let it be edited via the item PATCH endpoint.

**Files:**
- Modify: `src/app/api/inventory/route.ts` (PATCH handles `location`)
- Modify: `src/components/EditItemModal.tsx` (location input)
- Modify: `src/components/InventoryTable.tsx` (location column)
- Test: `tests/api/inventory-location-patch.test.ts` (pure handler-logic test via DB layer)

**Interfaces:**
- Consumes: `setItemLocation` (Task 2).
- Produces: PATCH `/api/inventory` accepts `{ id, location: string | null }`.

- [ ] **Step 1: Write the failing test (DB-layer round trip the PATCH will use)**

```ts
// tests/api/inventory-location-patch.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, listItems, setItemLocation } from "@/lib/db/inventory";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("inventory location patch path", () => {
  it("trims and stores a location, empty string clears it", () => {
    const id = createItemWithFirstPurchase(db, { name: "Box", lotId: null, purchasedOn: null, quantity: 1, unitCostCents: 50 });
    setItemLocation(db, id, "  Zone B / Shelf 4  ");
    expect(listItems(db).find((i) => i.id === id)?.location).toBe("Zone B / Shelf 4");
    setItemLocation(db, id, "");
    expect(listItems(db).find((i) => i.id === id)?.location).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/inventory-location-patch.test.ts`
Expected: FAIL if `setItemLocation` trimming/clearing not yet wired (it is from Task 2, so this may PASS immediately — that is acceptable; it locks the contract the PATCH relies on).

- [ ] **Step 3: Handle `location` in the PATCH route**

In `src/app/api/inventory/route.ts`, import `setItemLocation` and, inside the existing `PATCH` handler after the `body.name` block, add:

```ts
  if (body.location !== undefined) {
    if (body.location !== null && typeof body.location !== "string")
      return NextResponse.json({ error: "Invalid location" }, { status: 400 });
    setItemLocation(db, id, body.location);
  }
```

Update the import line to include `setItemLocation`.

- [ ] **Step 4: Add a location input to the edit modal**

In `src/components/EditItemModal.tsx`, accept an initial `location` prop and add a text input that PATCHes it. Extend the props type and state:

```ts
export function EditItemModal({ itemId, name, location, initialPurchases, onClose }: {
  itemId: number; name: string; location: string | null; initialPurchases: PurchaseRow[]; onClose: () => void;
}) {
  const [dLoc, setDLoc] = useState(location ?? "");
```

Add near the name input (inside the modal body):

```tsx
  <label className="block text-sm">
    <span className="text-slate-500">Location</span>
    <input className={`w-full ${INPUT_CLASS}`} placeholder="e.g. A3-2"
      value={dLoc} onChange={(e) => setDLoc(e.target.value)}
      onBlur={() => fetch("/api/inventory", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, location: dLoc.trim() || null }) })} />
  </label>
```

(Import `INPUT_CLASS` from `@/lib/ui/inputs` if not already imported.)

- [ ] **Step 5: Show location in the inventory table**

In `src/components/InventoryTable.tsx`, add a "Location" column header and cell rendering `item.location ?? "—"`. Match the existing header/cell markup used for other columns in that file; pass `location` through wherever the modal is opened (`location={item.location}`).

Also surface it on the count sheet: in `src/components/inventory/CountSheet.tsx`, if the row data includes the item, render `item.location ?? "—"` next to each item name so stock can be physically located during a count. (Read the component first to see how rows are shaped; if `location` isn't already passed to it, thread it through from the count page's item query, which uses `listItems`.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/api/inventory-location-patch.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/inventory/route.ts src/components/EditItemModal.tsx src/components/InventoryTable.tsx tests/api/inventory-location-patch.test.ts
git commit -m "feat(inventory): show and edit item location in UI"
```

---

### Task 4: Receiving / stock-in

A "Receive stock" action that records an incoming purchase batch onto an existing item, reusing `addPurchase` (which recomputes item totals).

**Files:**
- Create: `src/app/api/inventory/receive/route.ts`
- Create: `src/components/inventory/ReceiveStock.tsx`
- Modify: `src/app/inventory/page.tsx` (render the ReceiveStock control)
- Test: `tests/api/receive-stock.test.ts` (DB-layer behavior the route wraps)

**Interfaces:**
- Consumes: `addPurchase(db, { itemId, purchasedOn, quantity, unitCostCents })` from `src/lib/db/purchases.ts`; `listItems`.
- Produces: POST `/api/inventory/receive` with `{ itemId, quantity, unitCostCents, purchasedOn }` → `{ id }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/receive-stock.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, listItems } from "@/lib/db/inventory";
import { addPurchase, listPurchases } from "@/lib/db/purchases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("receiving stock", () => {
  it("adds a batch and increases qty_purchased via recompute", () => {
    const id = createItemWithFirstPurchase(db, { name: "Widget", lotId: null, purchasedOn: null, quantity: 10, unitCostCents: 100 });
    addPurchase(db, { itemId: id, purchasedOn: "2026-07-15", quantity: 5, unitCostCents: 120 });
    expect(listPurchases(db, id)).toHaveLength(2);
    expect(listItems(db).find((i) => i.id === id)?.qtyPurchased).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npx vitest run tests/api/receive-stock.test.ts`
Expected: PASS immediately (uses existing `addPurchase`). This test locks the contract the route depends on.

- [ ] **Step 3: Create the receive API route**

```ts
// src/app/api/inventory/receive/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { addPurchase } from "@/lib/db/purchases";

export async function POST(req: NextRequest) {
  const db = await dbForRequest();
  const body = await req.json();
  const itemId = Number(body.itemId);
  const quantity = Math.trunc(Number(body.quantity));
  const unitCostCents = Math.trunc(Number(body.unitCostCents));
  if (!Number.isInteger(itemId)) return NextResponse.json({ error: "Invalid item" }, { status: 400 });
  if (!(quantity >= 1)) return NextResponse.json({ error: "Quantity must be >= 1" }, { status: 400 });
  if (!(unitCostCents >= 0)) return NextResponse.json({ error: "Invalid unit cost" }, { status: 400 });
  const exists = db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(itemId);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const id = addPurchase(db, { itemId, purchasedOn: body.purchasedOn || null, quantity, unitCostCents });
  return NextResponse.json({ id });
}
```

- [ ] **Step 4: Create the ReceiveStock component**

```tsx
// src/components/inventory/ReceiveStock.tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function ReceiveStock({ items }: { items: { id: number; name: string }[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ itemId: "", quantity: "", cost: "", purchasedOn: today });
  return (
    <Card title="Receive stock">
      <form className="space-y-2 text-sm max-w-sm" onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/inventory/receive", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: Number(f.itemId), quantity: Number(f.quantity),
            unitCostCents: Math.round(Number(f.cost) * 100), purchasedOn: f.purchasedOn || null }) });
        if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not receive stock");
      }}>
        <select className={`w-full ${INPUT_CLASS}`} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })} required>
          <option value="">Select item…</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Quantity received" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Unit cost $" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
        <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.purchasedOn} onChange={(e) => setF({ ...f, purchasedOn: e.target.value })} />
        <Button type="submit">Receive</Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 5: Render it on the inventory page**

In `src/app/inventory/page.tsx`, import `ReceiveStock` and render it (pass the already-loaded items mapped to `{ id, name }`). Place it near the existing add/product controls:

```tsx
import { ReceiveStock } from "@/components/inventory/ReceiveStock";
// within the returned JSX, where item-management controls live:
<ReceiveStock items={items.map((i) => ({ id: i.id, name: i.name }))} />
```

(Use whatever variable already holds the item list on that page; if it is named differently, map that one.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/api/receive-stock.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/inventory/receive/route.ts src/components/inventory/ReceiveStock.tsx src/app/inventory/page.tsx tests/api/receive-stock.test.ts
git commit -m "feat(inventory): receive stock as a purchase batch"
```

---

### Task 5: Expenses reimbursement — schema + DB layer

Add `paid_by`, `reimbursable`, `reimbursed_on` to expenses; extend the DB layer with these fields and a "who's owed" query.

**Files:**
- Modify: `src/lib/db/schema.ts` (expenses columns)
- Modify: `src/lib/db/connection.ts` (idempotent migrations)
- Modify: `src/lib/db/expenses.ts` (`ExpenseRow`, insert/update/get/list, `setReimbursed`, `amountsOwedByPerson`)
- Test: `tests/lib/db/expenses-reimbursement.test.ts`

**Interfaces:**
- Produces:
  - `ExpenseRow` gains `paidBy: string | null; reimbursable: number; reimbursedOn: string | null`.
  - `insertExpense`/`updateExpense` accept `paidBy?`, `reimbursable?`, `reimbursedOn?`.
  - `setReimbursed(db, id, on: string | null): void` — sets/clears `reimbursed_on`.
  - `amountsOwedByPerson(db, range?): { person: string; totalCents: number }[]` — sums reimbursable AND not-yet-reimbursed expenses grouped by `paid_by`, desc by total.
- Consumes: existing `DateRange`/`rangeClause` in `expenses.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/db/expenses-reimbursement.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertExpense, getExpense, setReimbursed, amountsOwedByPerson } from "@/lib/db/expenses";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("expense reimbursement", () => {
  it("defaults reimbursable off and reimbursedOn null", () => {
    const id = insertExpense(db, { description: "Tape", type: "one_time", amountCents: 500 });
    expect(getExpense(db, id)).toMatchObject({ paidBy: null, reimbursable: 0, reimbursedOn: null });
  });

  it("stores paidBy + reimbursable and toggles reimbursed", () => {
    const id = insertExpense(db, { description: "Fuel", type: "one_time", amountCents: 4000, paidBy: "Sam", reimbursable: 1 });
    expect(getExpense(db, id)).toMatchObject({ paidBy: "Sam", reimbursable: 1, reimbursedOn: null });
    setReimbursed(db, id, "2026-07-16");
    expect(getExpense(db, id)?.reimbursedOn).toBe("2026-07-16");
    setReimbursed(db, id, null);
    expect(getExpense(db, id)?.reimbursedOn).toBeNull();
  });

  it("who's-owed sums only reimbursable + outstanding, grouped by person, desc", () => {
    insertExpense(db, { description: "a", type: "one_time", amountCents: 4000, paidBy: "Sam", reimbursable: 1 });
    insertExpense(db, { description: "b", type: "one_time", amountCents: 1000, paidBy: "Sam", reimbursable: 1 });
    insertExpense(db, { description: "c", type: "one_time", amountCents: 9000, paidBy: "Alex", reimbursable: 1 });
    // reimbursed => excluded:
    const paid = insertExpense(db, { description: "d", type: "one_time", amountCents: 9999, paidBy: "Sam", reimbursable: 1 });
    setReimbursed(db, paid, "2026-07-01");
    // not reimbursable => excluded:
    insertExpense(db, { description: "e", type: "one_time", amountCents: 8888, paidBy: "Sam", reimbursable: 0 });
    expect(amountsOwedByPerson(db)).toEqual([
      { person: "Alex", totalCents: 9000 },
      { person: "Sam", totalCents: 5000 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/expenses-reimbursement.test.ts`
Expected: FAIL — new fields/functions not present.

- [ ] **Step 3: Add columns to the fresh schema**

In `src/lib/db/schema.ts`, extend the `expenses` table:

```sql
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('one_time','recurring')),
  category TEXT,
  amount_cents INTEGER NOT NULL,
  incurred_on TEXT,
  paid_by TEXT,
  reimbursable INTEGER NOT NULL DEFAULT 0,
  reimbursed_on TEXT
);
```

- [ ] **Step 4: Add idempotent migrations**

In `src/lib/db/connection.ts` `migrate()`, add a new guarded block:

```ts
  const ecols = (db.prepare("PRAGMA table_info(expenses)").all() as { name: string }[]).map((c) => c.name);
  if (!ecols.includes("paid_by")) db.exec("ALTER TABLE expenses ADD COLUMN paid_by TEXT");
  if (!ecols.includes("reimbursable")) db.exec("ALTER TABLE expenses ADD COLUMN reimbursable INTEGER NOT NULL DEFAULT 0");
  if (!ecols.includes("reimbursed_on")) db.exec("ALTER TABLE expenses ADD COLUMN reimbursed_on TEXT");
```

- [ ] **Step 5: Extend the expenses DB layer**

In `src/lib/db/expenses.ts`:

Update the interface:

```ts
export interface ExpenseRow {
  id: number; description: string; type: "one_time" | "recurring";
  category: string | null; amountCents: number; incurredOn: string | null;
  paidBy: string | null; reimbursable: number; reimbursedOn: string | null;
}
```

Update `insertExpense` to accept and store the new fields:

```ts
export function insertExpense(db: DB, e: {
  description: string; type: "one_time" | "recurring";
  category?: string | null; amountCents: number; incurredOn?: string | null;
  paidBy?: string | null; reimbursable?: number; reimbursedOn?: string | null;
}): number {
  const info = db.prepare(`INSERT INTO expenses
    (description,type,category,amount_cents,incurred_on,paid_by,reimbursable,reimbursed_on)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      e.description, e.type, e.category ?? null, e.amountCents, e.incurredOn ?? null,
      e.paidBy?.trim() || null, e.reimbursable ? 1 : 0, e.reimbursedOn ?? null);
  return Number(info.lastInsertRowid);
}
```

Add the new columns to the SELECT in `listExpenses` and `getExpense`:

```ts
// in both queries replace the column list with:
`SELECT id, description, type, category, amount_cents as amountCents,
   incurred_on as incurredOn, paid_by as paidBy, reimbursable,
   reimbursed_on as reimbursedOn FROM expenses`
```

(Keep each function's existing `WHERE`/`ORDER BY`/args.)

Update `updateExpense` to persist the fields:

```ts
export function updateExpense(db: DB, id: number, e: {
  description: string; type: "one_time" | "recurring";
  category: string | null; amountCents: number; incurredOn: string | null;
  paidBy?: string | null; reimbursable?: number; reimbursedOn?: string | null;
}): void {
  db.prepare(`UPDATE expenses SET description=?, type=?, category=?, amount_cents=?, incurred_on=?,
    paid_by=?, reimbursable=?, reimbursed_on=? WHERE id=?`).run(
      e.description, e.type, e.category ?? null, e.amountCents, e.incurredOn ?? null,
      e.paidBy?.trim() || null, e.reimbursable ? 1 : 0, e.reimbursedOn ?? null, id);
}
```

Add two new functions at the end of the file:

```ts
/** Set (or clear, with null) the date an expense was reimbursed. */
export function setReimbursed(db: DB, id: number, on: string | null): void {
  db.prepare("UPDATE expenses SET reimbursed_on = ? WHERE id = ?").run(on ?? null, id);
}

/** Outstanding amounts owed to each person who fronted a reimbursable expense:
 *  reimbursable = 1 AND reimbursed_on IS NULL, grouped by paid_by, desc by total.
 *  Rows with no paid_by are ignored. */
export function amountsOwedByPerson(db: DB, range?: DateRange): { person: string; totalCents: number }[] {
  const { sql, args } = rangeClause(range);
  const where = sql ? `${sql} AND reimbursable = 1 AND reimbursed_on IS NULL AND TRIM(COALESCE(paid_by,'')) <> ''`
                    : ` WHERE reimbursable = 1 AND reimbursed_on IS NULL AND TRIM(COALESCE(paid_by,'')) <> ''`;
  const rows = db.prepare(
    `SELECT paid_by AS person, COALESCE(SUM(amount_cents),0) AS totalCents
     FROM expenses${where} GROUP BY paid_by ORDER BY totalCents DESC, person ASC`
  ).all(...args) as { person: string; totalCents: number }[];
  return rows.map((r) => ({ person: r.person, totalCents: Number(r.totalCents) }));
}
```

Note: `rangeClause` returns `" WHERE incurred_on ..."`, so appending ` AND ...` is valid when `sql` is non-empty. Verify by reading the existing `rangeClause` in the file before editing.

- [ ] **Step 6: Run the new test + existing expenses tests**

Run: `npx vitest run tests/lib/db/expenses-reimbursement.test.ts tests/lib/db/expenses.test.ts`
Expected: PASS (existing expenses tests still green — the extra `matchObject` fields are additive).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If any caller constructs `ExpenseRow` literals, they now need the three new fields — fix those call sites to include `paidBy`, `reimbursable`, `reimbursedOn`.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/expenses.ts tests/lib/db/expenses-reimbursement.test.ts
git commit -m "feat(expenses): reimbursement fields + who's-owed query"
```

---

### Task 6: Expenses reimbursement — UI

Add paid-by + reimbursable to the form, a reimbursed toggle in the table, and a "Who's owed" card.

**Files:**
- Modify: `src/components/ExpenseForm.tsx` (paid-by, reimbursable inputs)
- Modify: `src/app/api/expenses/route.ts` (POST passes new fields)
- Modify: `src/app/api/expenses/[id]/route.ts` (PATCH toggles reimbursed)
- Modify: `src/components/expenses/ExpensesTable.tsx` (paid-by column + reimburse toggle)
- Modify: `src/app/expenses/page.tsx` (Who's-owed card)
- Test: `tests/lib/db/expenses-reimbursement.test.ts` already covers logic; no new test file required for pure UI wiring.

**Interfaces:**
- Consumes: `insertExpense`, `setReimbursed`, `amountsOwedByPerson` (Task 5).
- Produces: POST `/api/expenses` accepts `paidBy`, `reimbursable`; PATCH `/api/expenses/[id]` accepts `{ reimbursedOn: string | null }`.

- [ ] **Step 1: Extend the POST route to accept new fields**

`src/app/api/expenses/route.ts` currently forwards the whole body to `insertExpense`. Since `insertExpense` now reads `paidBy`/`reimbursable`/`reimbursedOn` off its argument, no change is strictly required — but make the accepted shape explicit and safe:

```ts
export async function POST(req: NextRequest) {
  const b = await req.json();
  const id = insertExpense(await dbForRequest(), {
    description: b.description, type: b.type, category: b.category ?? null,
    amountCents: b.amountCents, incurredOn: b.incurredOn ?? null,
    paidBy: b.paidBy ?? null, reimbursable: b.reimbursable ? 1 : 0,
  });
  return NextResponse.json({ id });
}
```

- [ ] **Step 2: Add a reimbursed toggle to the PATCH route**

In `src/app/api/expenses/[id]/route.ts`, import `setReimbursed` and handle a `reimbursedOn` field. Read the existing handler first to match its param-extraction style (Next 15 dynamic route params are async: `const { id } = await context.params`). Add, before/after the existing update logic:

```ts
  if (body.reimbursedOn !== undefined) {
    setReimbursed(db, Number(id), body.reimbursedOn); // string date or null
    return NextResponse.json({ ok: true });
  }
```

- [ ] **Step 3: Add form fields**

In `src/components/ExpenseForm.tsx`, extend state and inputs:

```ts
const [f, setF] = useState({ description: "", type: "one_time", category: "", amount: "", incurredOn: today, paidBy: "", reimbursable: false });
```

Add before the submit button:

```tsx
  <input className={`w-full ${INPUT_CLASS}`} placeholder="Paid by (name)" value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value })} />
  <label className="flex items-center gap-2 text-slate-600">
    <input type="checkbox" checked={f.reimbursable} onChange={(e) => setF({ ...f, reimbursable: e.target.checked })} />
    Reimbursable (someone fronted it)
  </label>
```

Include the fields in the POST body:

```tsx
  body: JSON.stringify({ description: f.description, type: f.type, category: f.category,
    amountCents: Math.round(Number(f.amount) * 100), incurredOn: f.incurredOn || null,
    paidBy: f.paidBy.trim() || null, reimbursable: f.reimbursable }),
```

- [ ] **Step 4: Add paid-by column + reimburse toggle to the table**

In `src/components/expenses/ExpensesTable.tsx`, ensure the row type includes `paidBy`, `reimbursable`, `reimbursedOn` (widen the `rows` prop type to match `ExpenseRow`). Add a "Paid by" column showing `row.paidBy ?? "—"`, and a status control shown only when `row.reimbursable`:

```tsx
{row.reimbursable ? (
  row.reimbursedOn
    ? <button className="text-emerald-600 hover:underline" onClick={() => toggle(row.id, null)}>Reimbursed ✓</button>
    : <button className="text-amber-600 hover:underline" onClick={() => toggle(row.id, new Date().toISOString().slice(0,10))}>Mark reimbursed</button>
) : <span className="text-slate-400">—</span>}
```

With a helper in the component (this is a client component; add `"use client"` if not present):

```tsx
async function toggle(id: number, on: string | null) {
  await fetch(`/api/expenses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reimbursedOn: on }) });
  location.reload();
}
```

- [ ] **Step 5: Add the Who's-owed card to the page**

In `src/app/expenses/page.tsx`, import `amountsOwedByPerson`, compute it, and render a card:

```tsx
import { listExpenses, totalExpensesCents, expensesByCategory, amountsOwedByPerson } from "@/lib/db/expenses";
// ...
const owed = amountsOwedByPerson(db, range);
// ... in JSX, next to the "By category" card:
<Card title="Who's owed">
  {owed.length === 0 ? <p className="text-sm text-slate-400">Nobody is owed.</p> : (
    <ul className="space-y-1 text-sm">
      {owed.map((o) => (
        <li key={o.person} className="flex justify-between gap-6">
          <span>{o.person}</span><span className="font-medium"><Money cents={o.totalCents} /></span>
        </li>
      ))}
    </ul>
  )}
</Card>
```

- [ ] **Step 6: Typecheck + run expenses tests**

Run: `npx tsc --noEmit && npx vitest run tests/lib/db/expenses-reimbursement.test.ts`
Expected: no type errors; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ExpenseForm.tsx src/app/api/expenses/route.ts src/app/api/expenses/[id]/route.ts src/components/expenses/ExpensesTable.tsx src/app/expenses/page.tsx
git commit -m "feat(expenses): paid-by, reimburse toggle, who's-owed card"
```

---

### Task 7: Payroll — schema + DB layer

New `payroll_entries` table and a DB module mirroring `expenses.ts`, including auto-amount calc and per-person grouping.

**Files:**
- Modify: `src/lib/db/schema.ts` (new table)
- Create: `src/lib/db/payroll.ts`
- Create: `src/lib/calc/payroll-amount.ts` (pure auto-amount helper)
- Test: `tests/lib/calc/payroll-amount.test.ts`, `tests/lib/db/payroll.test.ts`

**Interfaces:**
- Produces:
  - `payrollAmountCents(hours: number | null, rateCents: number | null): number` — `round(hours*rateCents)`, or `0` when either is null/NaN.
  - `PayrollRow { id; person; periodStart: string|null; periodEnd: string|null; hours: number|null; rateCents: number|null; amountCents: number; note: string|null }`.
  - `insertPayroll`, `listPayroll(range?)`, `getPayroll`, `updatePayroll`, `deletePayroll`, `totalPayrollCents(range?)`, `payrollByPerson(range?)`.
  - `PayrollDateRange = { from?: string; to?: string }` — filtered on `period_end` (fallback `period_start`).
- Consumes: `createDb`, `DB`.

- [ ] **Step 1: Write the failing calc test**

```ts
// tests/lib/calc/payroll-amount.test.ts
import { describe, it, expect } from "vitest";
import { payrollAmountCents } from "@/lib/calc/payroll-amount";

describe("payrollAmountCents", () => {
  it("multiplies hours by rate and rounds to a cent", () => {
    expect(payrollAmountCents(30, 1500)).toBe(45000);
    expect(payrollAmountCents(2.5, 1333)).toBe(3333); // 3332.5 -> 3333
  });
  it("returns 0 when hours or rate is missing", () => {
    expect(payrollAmountCents(null, 1500)).toBe(0);
    expect(payrollAmountCents(10, null)).toBe(0);
    expect(payrollAmountCents(NaN, 1500)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/calc/payroll-amount.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the calc helper**

```ts
// src/lib/calc/payroll-amount.ts
/** Auto-calculated gross pay in cents: hours * rate, rounded. Returns 0 if either
 *  input is null/NaN (e.g. a flat entry with no hours — caller sets amount directly). */
export function payrollAmountCents(hours: number | null, rateCents: number | null): number {
  if (hours == null || rateCents == null) return 0;
  const h = Number(hours), r = Number(rateCents);
  if (!Number.isFinite(h) || !Number.isFinite(r)) return 0;
  return Math.round(h * r);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/calc/payroll-amount.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing DB test**

```ts
// tests/lib/db/payroll.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertPayroll, listPayroll, getPayroll, updatePayroll, deletePayroll,
  totalPayrollCents, payrollByPerson } from "@/lib/db/payroll";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("payroll DB layer", () => {
  it("inserts and reads back an entry", () => {
    const id = insertPayroll(db, { person: "Sam", periodStart: "2026-07-08", periodEnd: "2026-07-14", hours: 30, rateCents: 1500, amountCents: 45000, note: "week" });
    expect(getPayroll(db, id)).toMatchObject({ person: "Sam", hours: 30, rateCents: 1500, amountCents: 45000, periodEnd: "2026-07-14" });
  });

  it("updates and deletes", () => {
    const id = insertPayroll(db, { person: "Sam", periodStart: null, periodEnd: "2026-07-14", hours: null, rateCents: null, amountCents: 20000, note: null });
    updatePayroll(db, id, { person: "Sam", periodStart: null, periodEnd: "2026-07-14", hours: null, rateCents: null, amountCents: 25000, note: "bonus" });
    expect(getPayroll(db, id)?.amountCents).toBe(25000);
    deletePayroll(db, id);
    expect(getPayroll(db, id)).toBeNull();
  });

  it("filters by month on period_end and totals/ groups by person", () => {
    insertPayroll(db, { person: "Sam", periodStart: "2026-07-01", periodEnd: "2026-07-07", hours: 27, rateCents: 1500, amountCents: 40500, note: null });
    insertPayroll(db, { person: "Sam", periodStart: "2026-07-08", periodEnd: "2026-07-14", hours: 30, rateCents: 1500, amountCents: 45000, note: null });
    insertPayroll(db, { person: "Alex", periodStart: "2026-07-08", periodEnd: "2026-07-14", hours: 25, rateCents: 2000, amountCents: 50000, note: null });
    insertPayroll(db, { person: "Sam", periodStart: "2026-06-24", periodEnd: "2026-06-30", hours: 10, rateCents: 1500, amountCents: 15000, note: null });
    const july = { from: "2026-07-01", to: "2026-07-31" };
    expect(totalPayrollCents(db, july)).toBe(40500 + 45000 + 50000);
    expect(listPayroll(db, july)).toHaveLength(3);
    expect(payrollByPerson(db, july)).toEqual([
      { person: "Alex", totalCents: 50000 },
      { person: "Sam", totalCents: 85500 },
    ]);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/lib/db/payroll.test.ts`
Expected: FAIL — module/table missing.

- [ ] **Step 7: Add the table to the fresh schema**

Append to the schema string in `src/lib/db/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS payroll_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  hours REAL,
  rate_cents INTEGER,
  amount_cents INTEGER NOT NULL,
  note TEXT
);
```

(Because the table uses `CREATE TABLE IF NOT EXISTS` and `createDb` runs the schema on every open, existing DBs get it automatically — no separate migration needed.)

- [ ] **Step 8: Implement the DB module**

```ts
// src/lib/db/payroll.ts
import type { DB } from "./connection";

export interface PayrollRow {
  id: number; person: string; periodStart: string | null; periodEnd: string | null;
  hours: number | null; rateCents: number | null; amountCents: number; note: string | null;
}

export type PayrollDateRange = { from?: string; to?: string };

/** Filter on period_end, falling back to period_start when period_end is null. */
function rangeClause(range?: PayrollDateRange): { sql: string; args: string[] } {
  if (!range || (!range.from && !range.to)) return { sql: "", args: [] };
  const col = "COALESCE(period_end, period_start)";
  const parts: string[] = [`${col} IS NOT NULL`];
  const args: string[] = [];
  if (range.from) { parts.push(`${col} >= ?`); args.push(range.from); }
  if (range.to) { parts.push(`${col} <= ?`); args.push(range.to); }
  return { sql: " WHERE " + parts.join(" AND "), args };
}

const COLS = `id, person, period_start AS periodStart, period_end AS periodEnd,
  hours, rate_cents AS rateCents, amount_cents AS amountCents, note`;

export function insertPayroll(db: DB, e: {
  person: string; periodStart?: string | null; periodEnd?: string | null;
  hours?: number | null; rateCents?: number | null; amountCents: number; note?: string | null;
}): number {
  const info = db.prepare(`INSERT INTO payroll_entries
    (person, period_start, period_end, hours, rate_cents, amount_cents, note)
    VALUES (?,?,?,?,?,?,?)`).run(
      e.person.trim(), e.periodStart ?? null, e.periodEnd ?? null,
      e.hours ?? null, e.rateCents ?? null, e.amountCents, e.note?.trim() || null);
  return Number(info.lastInsertRowid);
}

export function listPayroll(db: DB, range?: PayrollDateRange): PayrollRow[] {
  const { sql, args } = rangeClause(range);
  return db.prepare(`SELECT ${COLS} FROM payroll_entries${sql}
    ORDER BY COALESCE(period_end, period_start) DESC, id DESC`).all(...args) as PayrollRow[];
}

export function getPayroll(db: DB, id: number): PayrollRow | null {
  const r = db.prepare(`SELECT ${COLS} FROM payroll_entries WHERE id = ?`).get(id) as PayrollRow | undefined;
  return r ?? null;
}

export function updatePayroll(db: DB, id: number, e: {
  person: string; periodStart: string | null; periodEnd: string | null;
  hours: number | null; rateCents: number | null; amountCents: number; note: string | null;
}): void {
  db.prepare(`UPDATE payroll_entries SET person=?, period_start=?, period_end=?, hours=?,
    rate_cents=?, amount_cents=?, note=? WHERE id=?`).run(
      e.person.trim(), e.periodStart ?? null, e.periodEnd ?? null, e.hours ?? null,
      e.rateCents ?? null, e.amountCents, e.note?.trim() || null, id);
}

export function deletePayroll(db: DB, id: number): void {
  db.prepare("DELETE FROM payroll_entries WHERE id = ?").run(id);
}

export function totalPayrollCents(db: DB, range?: PayrollDateRange): number {
  const { sql, args } = rangeClause(range);
  const r = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM payroll_entries${sql}`).get(...args) as { t: number };
  return Number(r.t);
}

export function payrollByPerson(db: DB, range?: PayrollDateRange): { person: string; totalCents: number }[] {
  const { sql, args } = rangeClause(range);
  const rows = db.prepare(
    `SELECT person, COALESCE(SUM(amount_cents),0) AS totalCents FROM payroll_entries${sql}
     GROUP BY person ORDER BY totalCents DESC, person ASC`
  ).all(...args) as { person: string; totalCents: number }[];
  return rows.map((r) => ({ person: r.person, totalCents: Number(r.totalCents) }));
}
```

- [ ] **Step 9: Run both payroll tests**

Run: `npx vitest run tests/lib/db/payroll.test.ts tests/lib/calc/payroll-amount.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/payroll.ts src/lib/calc/payroll-amount.ts tests/lib/db/payroll.test.ts tests/lib/calc/payroll-amount.test.ts
git commit -m "feat(payroll): schema, DB layer, and auto-amount calc"
```

---

### Task 8: Payroll — page, form, API, nav

Payroll page with an entry form (auto-amount), month-filtered log, per-person totals, plus API routes.

**Files:**
- Create: `src/app/api/payroll/route.ts` (GET/POST)
- Create: `src/app/api/payroll/[id]/route.ts` (DELETE)
- Create: `src/components/payroll/PayrollForm.tsx`
- Create: `src/components/payroll/PayrollMonthFilter.tsx`
- Create: `src/components/payroll/PayrollTable.tsx`
- Create: `src/app/payroll/page.tsx`
- Modify: `src/components/Nav.tsx` (add Payroll link)
- Test: covered by Task 7 DB tests; no new logic test required for UI wiring.

**Interfaces:**
- Consumes: Task 7 DB functions, `payrollAmountCents`, `rangeFromParams` (generalized — see Step 1).
- Produces: POST `/api/payroll` `{ person, periodStart, periodEnd, hours, rateCents, amountCents, note }`; DELETE `/api/payroll/[id]`.

- [ ] **Step 1: Generalize the month-range helper (reuse, don't duplicate)**

`rangeFromParams` in `src/lib/ui/expense-range.ts` returns a `DateRange` (`{from,to}`) that is structurally identical to `PayrollDateRange`. Reuse it directly — import `rangeFromParams` in the payroll page. No new helper needed. (Do NOT copy the month-expansion logic — DRY.)

- [ ] **Step 2: Create the payroll API routes**

```ts
// src/app/api/payroll/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { insertPayroll, listPayroll } from "@/lib/db/payroll";

export async function GET() {
  return NextResponse.json(listPayroll(await dbForRequest()));
}
export async function POST(req: NextRequest) {
  const b = await req.json();
  const person = typeof b.person === "string" ? b.person.trim() : "";
  if (!person) return NextResponse.json({ error: "Person is required" }, { status: 400 });
  if (!Number.isFinite(Number(b.amountCents))) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  const id = insertPayroll(await dbForRequest(), {
    person, periodStart: b.periodStart || null, periodEnd: b.periodEnd || null,
    hours: b.hours == null || b.hours === "" ? null : Number(b.hours),
    rateCents: b.rateCents == null || b.rateCents === "" ? null : Math.trunc(Number(b.rateCents)),
    amountCents: Math.trunc(Number(b.amountCents)), note: b.note ?? null,
  });
  return NextResponse.json({ id });
}
```

```ts
// src/app/api/payroll/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { deletePayroll } from "@/lib/db/payroll";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deletePayroll(await dbForRequest(), Number(id));
  return NextResponse.json({ ok: true });
}
```

(Confirm the async-`params` signature against `src/app/api/expenses/[id]/route.ts` and match it exactly.)

- [ ] **Step 3: Create the PayrollForm with live auto-amount**

```tsx
// src/components/payroll/PayrollForm.tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { payrollAmountCents } from "@/lib/calc/payroll-amount";

export function PayrollForm() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ person: "", periodStart: today, periodEnd: today, hours: "", rate: "", note: "" });
  const rateCents = f.rate === "" ? null : Math.round(Number(f.rate) * 100);
  const hours = f.hours === "" ? null : Number(f.hours);
  const autoCents = payrollAmountCents(hours, rateCents);
  return (
    <Card title="Add payroll entry">
      <form className="space-y-2 text-sm max-w-sm" onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/payroll", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person: f.person, periodStart: f.periodStart || null, periodEnd: f.periodEnd || null,
            hours, rateCents, amountCents: autoCents, note: f.note || null }) });
        if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
      }}>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Person" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} required />
        <div className="flex gap-2">
          <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} />
          <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <input className={`w-full ${INPUT_CLASS}`} placeholder="Hours" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          <input className={`w-full ${INPUT_CLASS}`} placeholder="Rate $/hr" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        </div>
        <p className="text-slate-500">Amount: <span className="font-medium">${(autoCents / 100).toFixed(2)}</span></p>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <Button type="submit">Add</Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 4: Create the PayrollMonthFilter**

Mirror `MonthFilter` but point at `/payroll`:

```tsx
// src/components/payroll/PayrollMonthFilter.tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";

export function PayrollMonthFilter() {
  const router = useRouter();
  const params = useSearchParams();
  const month = params.get("month") ?? "";
  const set = (m: string) => router.push(m ? `/payroll?month=${m}` : "/payroll");
  return (
    <div className="flex items-center gap-2 text-sm">
      <input type="month" value={month} onChange={(e) => set(e.target.value)}
        className="rounded-xl border border-line bg-white px-3 py-2 text-sm" />
      {month && <button onClick={() => set("")} className="text-slate-500 hover:underline">All time</button>}
    </div>
  );
}
```

- [ ] **Step 5: Create the PayrollTable**

```tsx
// src/components/payroll/PayrollTable.tsx
"use client";
import { Money } from "@/components/Money";
import type { PayrollRow } from "@/lib/db/payroll";

export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  async function del(id: number) {
    if (!confirm("Delete this payroll entry?")) return;
    await fetch(`/api/payroll/${id}`, { method: "DELETE" });
    location.reload();
  }
  if (rows.length === 0) return <p className="text-sm text-slate-400">No payroll entries in range.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-slate-500">
        <th className="py-2">Period</th><th>Person</th><th>Hours</th><th>Rate</th><th>Amount</th><th>Note</th><th></th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-line">
            <td className="py-2">{r.periodStart ?? "—"}{r.periodEnd ? ` → ${r.periodEnd}` : ""}</td>
            <td>{r.person}</td>
            <td>{r.hours ?? "—"}</td>
            <td>{r.rateCents == null ? "—" : <Money cents={r.rateCents} />}</td>
            <td><Money cents={r.amountCents} /></td>
            <td>{r.note ?? "—"}</td>
            <td><button className="text-slate-400 hover:text-red-600" onClick={() => del(r.id)}>Delete</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 6: Create the payroll page**

```tsx
// src/app/payroll/page.tsx
import { Suspense } from "react";
import { dbForRequest } from "@/lib/auth/request";
import { listPayroll, totalPayrollCents, payrollByPerson } from "@/lib/db/payroll";
import { rangeFromParams } from "@/lib/ui/expense-range";
import { PayrollForm } from "@/components/payroll/PayrollForm";
import { PayrollTable } from "@/components/payroll/PayrollTable";
import { PayrollMonthFilter } from "@/components/payroll/PayrollMonthFilter";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const range = rangeFromParams(sp);
  const db = await dbForRequest();
  const rows = listPayroll(db, range);
  const byPerson = payrollByPerson(db, range);
  return (
    <div className="space-y-6">
      <PageHeader title="Payroll" subtitle="Wages paid to people" action={<Suspense fallback={null}><PayrollMonthFilter /></Suspense>} />
      <div className="grid gap-4 sm:grid-cols-[auto,1fr] sm:items-start">
        <Stat label={range ? "Total (selected period)" : "Total payroll"} value={<Money cents={totalPayrollCents(db, range)} />} />
        <Card title="By person">
          {byPerson.length === 0 ? <p className="text-sm text-slate-400">No payroll in range.</p> : (
            <ul className="space-y-1 text-sm">
              {byPerson.map((p) => (
                <li key={p.person} className="flex justify-between gap-6"><span>{p.person}</span><span className="font-medium"><Money cents={p.totalCents} /></span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <PayrollTable rows={rows} />
      <PayrollForm />
    </div>
  );
}
```

- [ ] **Step 7: Add Payroll to the nav**

In `src/components/Nav.tsx`, add to `baseLinks` (after Expenses):

```ts
  ["/expenses", "Expenses"], ["/payroll", "Payroll"], ["/report", "Report"], ["/settings", "Settings"],
```

- [ ] **Step 8: Typecheck + full test run**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/payroll src/components/payroll src/app/payroll/page.tsx src/components/Nav.tsx
git commit -m "feat(payroll): page, form, month filter, API routes, nav link"
```

---

### Task 9: Branding & docs

Rename the app from "Whatnot Business Manager" to the warehouse name and update docs.

**Files:**
- Modify: `package.json` (`name`)
- Modify: `README.md` (title + description)
- Modify: `src/components/Nav.tsx` (header wordmark)
- Modify: `src/app/layout.tsx` (page `<title>`/metadata if present)

**Interfaces:** none (cosmetic).

- [ ] **Step 1: Update the nav wordmark**

In `src/components/Nav.tsx`, replace the wordmark text:

```tsx
<span className="shrink-0 py-4 text-sm font-bold tracking-tight text-brand-600">◆ Warehouse Manager</span>
```

- [ ] **Step 2: Update layout metadata**

In `src/app/layout.tsx`, if a `metadata`/`title` export exists, set the title to `Warehouse Manager`. (Read the file first; match its existing metadata shape.)

- [ ] **Step 3: Update package.json name**

Set `"name": "warehouse-manager"` in `package.json`.

- [ ] **Step 4: Update README**

Replace the top title/description lines in `README.md`:

```markdown
# Warehouse Manager

Self-hosted Next.js + SQLite app to manage warehouse inventory, receiving, payroll,
and expenses (with reimbursement tracking), plus a Whatnot sales aggregator.
```

Leave the multi-user / data-layout sections, but add a note that all logged-in users now share one workspace (`data/ws/0.db`); logins gate access only.

- [ ] **Step 5: Typecheck + build sanity**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json README.md src/components/Nav.tsx src/app/layout.tsx
git commit -m "chore: rebrand to Warehouse Manager"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests PASS (existing + new).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, then verify in the browser:
- Log in; land on the shared workspace (existing Whatnot/inventory data visible).
- Inventory: set a location on an item; receive stock and confirm quantity increases.
- Expenses: add a reimbursable expense paid by a name; see it under "Who's owed"; mark reimbursed; it leaves the owed list.
- Payroll: add an entry with hours+rate; confirm auto-amount; filter by month; per-person total correct; delete an entry.

- [ ] **Step 4: Commit any smoke-test fixes, then hand off**

If fixes were needed, commit them. Otherwise the branch is ready for `superpowers:finishing-a-development-branch`.
