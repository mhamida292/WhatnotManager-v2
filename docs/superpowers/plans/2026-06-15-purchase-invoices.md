# Purchase Invoices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a purchase-invoices feature: create draft invoices with multiple product lines, post them to stock inventory (via purchase batches), and view/print each as a document.

**Architecture:** Two new tables (`invoices`, `invoice_lines`) plus an `invoice_id` column on `item_purchases`. Posting turns each invoice line into a purchase batch carrying the invoice id (reusing the weighted-average recompute); unpost/delete reverse it. Drafts never touch inventory. New Invoices pages (list, editor/document, print).

**Tech Stack:** Next.js App Router (server components + route handlers), better-sqlite3, React client components, vitest. Spec: `docs/superpowers/specs/2026-06-15-purchase-invoices-design.md`.

**Sequencing:** Tasks 1–6 = data model (tested, green). Tasks 7–10 = API. Tasks 11–15 = UI. App stays green after every task.

---

### Task 1: Schema — invoices, invoice_lines, item_purchases.invoice_id

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/connection.ts`
- Test: `tests/lib/db/invoices.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/invoices.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("invoices schema", () => {
  it("has invoices and invoice_lines tables and item_purchases.invoice_id", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain("invoices");
    expect(tables).toContain("invoice_lines");
    const cols = (db.prepare("PRAGMA table_info(item_purchases)").all() as any[]).map((c) => c.name);
    expect(cols).toContain("invoice_id");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: FAIL — tables/column missing.

- [ ] **Step 3: Add the tables and column**

In `src/lib/db/schema.ts`, add these two tables to the `SCHEMA` string **immediately after the `inventory_items` table and before `item_purchases`** (so `item_purchases.invoice_id` and `invoice_lines` can reference `invoices`):

```sql
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT,
  invoice_date TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  posted_at TEXT
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL
);
```

Then change the `item_purchases` table definition to add an `invoice_id` column. It should read:

```sql
CREATE TABLE IF NOT EXISTS item_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  purchased_on TEXT,
  quantity INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE
);
```

In `src/lib/db/connection.ts`, add this idempotent column migration as a statement inside the existing `migrate(db)` function (for databases created before this column existed):

```ts
  const pcols = (db.prepare("PRAGMA table_info(item_purchases)").all() as { name: string }[]).map((c) => c.name);
  if (!pcols.includes("invoice_id")) {
    db.exec("ALTER TABLE item_purchases ADD COLUMN invoice_id INTEGER REFERENCES invoices(id)");
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts tests/lib/db/invoices.test.ts
git commit -m "feat(db): invoices + invoice_lines tables, item_purchases.invoice_id"
```

---

### Task 2: invoices repo — create, get, list, update, number

**Files:**
- Create: `src/lib/db/invoices.ts`
- Test: `tests/lib/db/invoices.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/db/invoices.test.ts` a new describe block. Add this import at the top: `import { invoiceNumber, createInvoice, getInvoice, listInvoices, updateInvoice } from "@/lib/db/invoices";` (later tasks will extend this same import line with more functions).

```ts
describe("invoices repo", () => {
  it("invoiceNumber formats the id as INV-0007", () => {
    expect(invoiceNumber(7)).toBe("INV-0007");
    expect(invoiceNumber(1234)).toBe("INV-1234");
  });

  it("createInvoice makes a draft; getInvoice and listInvoices return it", () => {
    const id = createInvoice(db, { supplier: "Squishy Co", invoiceDate: "2026-06-15", notes: "order 99" });
    const inv = getInvoice(db, id)!;
    expect(inv).toMatchObject({ id, number: invoiceNumber(id), supplier: "Squishy Co", invoiceDate: "2026-06-15", status: "draft", total: 0 });
    expect(inv.postedAt).toBeNull();
    expect(listInvoices(db).map((i) => i.id)).toContain(id);
  });

  it("updateInvoice changes header fields", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    updateInvoice(db, id, { supplier: "AliExpress", invoiceDate: "2026-06-01", notes: "x" });
    expect(getInvoice(db, id)).toMatchObject({ supplier: "AliExpress", invoiceDate: "2026-06-01", notes: "x" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: FAIL — cannot find module `@/lib/db/invoices`.

- [ ] **Step 3: Create the repo**

Create `src/lib/db/invoices.ts`:

```ts
import type { DB } from "./connection";

export interface Invoice {
  id: number; number: string; supplier: string | null; invoiceDate: string | null;
  notes: string | null; status: "draft" | "posted"; postedAt: string | null; total: number;
}
export interface InvoiceLine {
  id: number; invoiceId: number; itemId: number | null; productName: string; quantity: number; unitCostCents: number;
}

/** Display number derived from the row id, e.g. 7 -> "INV-0007". */
export function invoiceNumber(id: number): string {
  return `INV-${String(id).padStart(4, "0")}`;
}

const SELECT = `
  SELECT i.id, i.supplier, i.invoice_date AS invoiceDate, i.notes, i.status, i.posted_at AS postedAt,
    COALESCE((SELECT SUM(quantity * unit_cost_cents) FROM invoice_lines WHERE invoice_id = i.id), 0) AS total
  FROM invoices i`;

function hydrate(row: any): Invoice {
  return { ...row, number: invoiceNumber(row.id), total: Number(row.total) };
}

export function createInvoice(db: DB, p: { supplier: string | null; invoiceDate: string | null; notes: string | null }): number {
  const info = db.prepare("INSERT INTO invoices (supplier, invoice_date, notes) VALUES (?,?,?)")
    .run(p.supplier, p.invoiceDate, p.notes);
  return Number(info.lastInsertRowid);
}

export function updateInvoice(db: DB, id: number, p: { supplier: string | null; invoiceDate: string | null; notes: string | null }): void {
  db.prepare("UPDATE invoices SET supplier = ?, invoice_date = ?, notes = ? WHERE id = ? AND status = 'draft'")
    .run(p.supplier, p.invoiceDate, p.notes, id);
}

export function getInvoice(db: DB, id: number): Invoice | null {
  const row = db.prepare(`${SELECT} WHERE i.id = ?`).get(id);
  return row ? hydrate(row) : null;
}

export function listInvoices(db: DB): Invoice[] {
  return (db.prepare(`${SELECT} ORDER BY i.id DESC`).all() as any[]).map(hydrate);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: the three Task 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/invoices.ts tests/lib/db/invoices.test.ts
git commit -m "feat(db): invoices repo — create/get/list/update + number formatter"
```

---

### Task 3: invoice line CRUD (draft-only)

**Files:**
- Modify: `src/lib/db/invoices.ts`
- Test: `tests/lib/db/invoices.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a describe block to `tests/lib/db/invoices.test.ts`. Ensure the import line includes `addInvoiceLine, updateInvoiceLine, deleteInvoiceLine, listInvoiceLines`. Also import `insertItem` from `@/lib/db/inventory` and `postInvoice` is NOT needed here.

```ts
import { insertItem } from "@/lib/db/inventory";

describe("invoice lines", () => {
  it("addInvoiceLine adds lines and updates the invoice total; listInvoiceLines returns them", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: "2026-06-15", notes: null });
    const item = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Jellyfish", quantity: 12, unitCostCents: 150 });
    addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "Pineapple", quantity: 11, unitCostCents: 150 });
    const lines = listInvoiceLines(db, id);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ productName: "Jellyfish", quantity: 12, unitCostCents: 150, itemId: item });
    expect(getInvoice(db, id)!.total).toBe(12 * 150 + 11 * 150);
  });

  it("updateInvoiceLine and deleteInvoiceLine modify lines", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "X", quantity: 5, unitCostCents: 100 });
    updateInvoiceLine(db, lineId, { itemId: null, productName: "X", quantity: 6, unitCostCents: 120 });
    expect(listInvoiceLines(db, id)[0]).toMatchObject({ quantity: 6, unitCostCents: 120 });
    deleteInvoiceLine(db, lineId);
    expect(listInvoiceLines(db, id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: FAIL — `addInvoiceLine is not a function`.

- [ ] **Step 3: Implement line CRUD**

Add to `src/lib/db/invoices.ts`:

```ts
/** Throws if the invoice is not an editable draft. */
function assertDraft(db: DB, invoiceId: number): void {
  const r = db.prepare("SELECT status FROM invoices WHERE id = ?").get(invoiceId) as { status: string } | undefined;
  if (!r || r.status !== "draft") throw new Error("Invoice is not an editable draft");
}

export function listInvoiceLines(db: DB, invoiceId: number): InvoiceLine[] {
  return db.prepare(
    "SELECT id, invoice_id AS invoiceId, item_id AS itemId, product_name AS productName, quantity, unit_cost_cents AS unitCostCents FROM invoice_lines WHERE invoice_id = ? ORDER BY id"
  ).all(invoiceId) as InvoiceLine[];
}

export function addInvoiceLine(db: DB, p: { invoiceId: number; itemId: number | null; productName: string; quantity: number; unitCostCents: number }): number {
  assertDraft(db, p.invoiceId);
  const info = db.prepare(
    "INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents) VALUES (?,?,?,?,?)"
  ).run(p.invoiceId, p.itemId, p.productName, p.quantity, p.unitCostCents);
  return Number(info.lastInsertRowid);
}

export function updateInvoiceLine(db: DB, id: number, p: { itemId: number | null; productName: string; quantity: number; unitCostCents: number }): void {
  const row = db.prepare("SELECT invoice_id AS invoiceId FROM invoice_lines WHERE id = ?").get(id) as { invoiceId: number } | undefined;
  if (!row) return;
  assertDraft(db, row.invoiceId);
  db.prepare("UPDATE invoice_lines SET item_id = ?, product_name = ?, quantity = ?, unit_cost_cents = ? WHERE id = ?")
    .run(p.itemId, p.productName, p.quantity, p.unitCostCents, id);
}

export function deleteInvoiceLine(db: DB, id: number): void {
  const row = db.prepare("SELECT invoice_id AS invoiceId FROM invoice_lines WHERE id = ?").get(id) as { invoiceId: number } | undefined;
  if (!row) return;
  assertDraft(db, row.invoiceId);
  db.prepare("DELETE FROM invoice_lines WHERE id = ?").run(id);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/invoices.ts tests/lib/db/invoices.test.ts
git commit -m "feat(db): invoice line CRUD (draft-only)"
```

---

### Task 4: `addPurchase` invoiceId + `listPurchases` exposes it

**Files:**
- Modify: `src/lib/db/purchases.ts`
- Test: `tests/lib/db/purchases.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/db/purchases.test.ts` inside the existing describe block:

```ts
it("addPurchase records an optional invoiceId, exposed by listPurchases", () => {
  const id = insertItem(db, { name: "Gel", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  db.prepare("INSERT INTO invoices (supplier) VALUES ('Co')").run();
  const invId = Number((db.prepare("SELECT id FROM invoices").get() as any).id);
  addPurchase(db, { itemId: id, purchasedOn: null, quantity: 5, unitCostCents: 100, invoiceId: invId });
  addPurchase(db, { itemId: id, purchasedOn: null, quantity: 3, unitCostCents: 100 });
  const rows = listPurchases(db, id);
  expect(rows.find((r) => r.quantity === 5)!.invoiceId).toBe(invId);
  expect(rows.find((r) => r.quantity === 3)!.invoiceId).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: FAIL — `invoiceId` is undefined on the rows.

- [ ] **Step 3: Implement**

In `src/lib/db/purchases.ts`:

1. Add `invoiceId: number | null;` to the `Purchase` interface.
2. Change `listPurchases`'s SELECT to include the column:

```ts
export function listPurchases(db: DB, itemId: number): Purchase[] {
  return db.prepare(
    "SELECT id, item_id AS itemId, purchased_on AS purchasedOn, quantity, unit_cost_cents AS unitCostCents, invoice_id AS invoiceId FROM item_purchases WHERE item_id = ? ORDER BY purchased_on, id"
  ).all(itemId) as Purchase[];
}
```

3. Change `addPurchase` to accept and store `invoiceId` (default null):

```ts
export function addPurchase(db: DB, p: { itemId: number; purchasedOn: string | null; quantity: number; unitCostCents: number; invoiceId?: number | null }): number {
  const tx = db.transaction((p: { itemId: number; purchasedOn: string | null; quantity: number; unitCostCents: number; invoiceId?: number | null }) => {
    const info = db.prepare(
      "INSERT INTO item_purchases (item_id, purchased_on, quantity, unit_cost_cents, invoice_id) VALUES (?,?,?,?,?)"
    ).run(p.itemId, p.purchasedOn ?? null, p.quantity, p.unitCostCents, p.invoiceId ?? null);
    recomputeItemTotals(db, p.itemId);
    return Number(info.lastInsertRowid);
  });
  return tx(p);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/db/purchases.test.ts`
Expected: PASS (all existing purchase tests still pass too).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/purchases.ts tests/lib/db/purchases.test.ts
git commit -m "feat(db): addPurchase optional invoiceId; listPurchases exposes it"
```

---

### Task 5: `postInvoice`

**Files:**
- Modify: `src/lib/db/invoices.ts`
- Test: `tests/lib/db/invoices.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/db/invoices.test.ts`. Add `postInvoice` to the `@/lib/db/invoices` import, and `import { listPurchases } from "@/lib/db/purchases";` and `import { listItems, qtyRemaining } from "@/lib/db/inventory";`.

```ts
describe("postInvoice", () => {
  it("posts: creates batches, makes new products, recomputes totals, sets status", () => {
    const id = createInvoice(db, { supplier: "Co", invoiceDate: "2026-06-15", notes: null });
    const jelly = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: jelly, productName: "Jellyfish", quantity: 12, unitCostCents: 150 });
    addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "Pineapple", quantity: 11, unitCostCents: 200 });

    postInvoice(db, id);

    expect(getInvoice(db, id)!.status).toBe("posted");
    expect(getInvoice(db, id)!.postedAt).not.toBeNull();
    expect(qtyRemaining(db, jelly)).toBe(12);
    const pineapple = listItems(db).find((i) => i.name === "Pineapple")!;
    expect(pineapple.qtyPurchased).toBe(11);
    expect(pineapple.unitCostCents).toBe(200);
    // batches carry the invoice id
    expect(listPurchases(db, jelly)[0].invoiceId).toBe(id);
  });

  it("a new-product line whose name matches an existing item links to it (no duplicate)", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "cheese", quantity: 4, unitCostCents: 250 });
    postInvoice(db, id);
    expect(listItems(db).filter((i) => i.name.toLowerCase() === "cheese")).toHaveLength(1);
    expect(qtyRemaining(db, cheese)).toBe(4);
  });

  it("posting an empty invoice throws", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    expect(() => postInvoice(db, id)).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: FAIL — `postInvoice is not a function`.

- [ ] **Step 3: Implement**

Add to `src/lib/db/invoices.ts`. Add these imports at the top:

```ts
import { insertItem } from "./inventory";
import { addPurchase, recomputeItemTotals } from "./purchases";
```

Then:

```ts
/** Post a draft: each line becomes a purchase batch (creating/linking products),
 *  stocking inventory and recomputing item totals. Atomic. */
export function postInvoice(db: DB, id: number): void {
  const tx = db.transaction(() => {
    const inv = db.prepare("SELECT status, invoice_date AS invoiceDate FROM invoices WHERE id = ?").get(id) as { status: string; invoiceDate: string | null } | undefined;
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "draft") throw new Error("Invoice is already posted");
    const lines = listInvoiceLines(db, id);
    if (lines.length === 0) throw new Error("Cannot post an empty invoice");
    for (const line of lines) {
      let itemId = line.itemId;
      if (itemId == null) {
        const existing = db.prepare("SELECT id FROM inventory_items WHERE lower(name) = lower(?)").get(line.productName) as { id: number } | undefined;
        itemId = existing ? existing.id : insertItem(db, { name: line.productName, unitCostCents: line.unitCostCents, qtyPurchased: 0, lotId: null });
        db.prepare("UPDATE invoice_lines SET item_id = ? WHERE id = ?").run(itemId, line.id);
      }
      addPurchase(db, { itemId, purchasedOn: inv.invoiceDate, quantity: line.quantity, unitCostCents: line.unitCostCents, invoiceId: id });
    }
    db.prepare("UPDATE invoices SET status = 'posted', posted_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  });
  tx();
}
```

(`recomputeItemTotals` is imported for Task 6; importing it now is harmless.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/invoices.ts tests/lib/db/invoices.test.ts
git commit -m "feat(db): postInvoice — stock inventory from invoice lines"
```

---

### Task 6: `unpostInvoice` + `deleteInvoice`

**Files:**
- Modify: `src/lib/db/invoices.ts`
- Test: `tests/lib/db/invoices.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/db/invoices.test.ts`. Add `unpostInvoice, deleteInvoice` to the `@/lib/db/invoices` import.

```ts
describe("unpost and delete invoice", () => {
  it("unpostInvoice pulls the stock back, reverts totals, returns to draft, keeps lines", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: "2026-06-15", notes: null });
    const jelly = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: jelly, productName: "Jellyfish", quantity: 12, unitCostCents: 150 });
    postInvoice(db, id);
    expect(qtyRemaining(db, jelly)).toBe(12);

    unpostInvoice(db, id);
    expect(getInvoice(db, id)!.status).toBe("draft");
    expect(getInvoice(db, id)!.postedAt).toBeNull();
    expect(qtyRemaining(db, jelly)).toBe(0);
    expect(listInvoiceLines(db, id)).toHaveLength(1); // lines kept
    expect(listPurchases(db, jelly)).toHaveLength(0); // batch removed
  });

  it("deleteInvoice removes header + lines + batches and recomputes items", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    const jelly = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: jelly, productName: "Jellyfish", quantity: 8, unitCostCents: 150 });
    postInvoice(db, id);

    deleteInvoice(db, id);
    expect(getInvoice(db, id)).toBeNull();
    expect(listInvoiceLines(db, id)).toHaveLength(0);
    expect(qtyRemaining(db, jelly)).toBe(0);
    expect(listPurchases(db, jelly)).toHaveLength(0);
  });

  it("invoice operations leave manual (non-invoice) batches alone", () => {
    const jelly = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: jelly, purchasedOn: null, quantity: 5, unitCostCents: 100 }); // manual
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    addInvoiceLine(db, { invoiceId: id, itemId: jelly, productName: "Jellyfish", quantity: 3, unitCostCents: 200 });
    postInvoice(db, id);
    deleteInvoice(db, id);
    expect(qtyRemaining(db, jelly)).toBe(5); // only the manual batch remains
  });
});
```

Add `import { addPurchase } from "@/lib/db/purchases";` if not already imported (it is, from Task 5).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: FAIL — `unpostInvoice is not a function`.

- [ ] **Step 3: Implement**

Add to `src/lib/db/invoices.ts`:

```ts
/** Reverse a posted invoice: remove its batches, recompute affected items, return
 *  to draft. Lines are kept. Atomic. */
export function unpostInvoice(db: DB, id: number): void {
  const tx = db.transaction(() => {
    const itemIds = (db.prepare("SELECT DISTINCT item_id AS id FROM item_purchases WHERE invoice_id = ?").all(id) as { id: number }[]).map((r) => r.id);
    db.prepare("DELETE FROM item_purchases WHERE invoice_id = ?").run(id);
    for (const itemId of itemIds) recomputeItemTotals(db, itemId);
    db.prepare("UPDATE invoices SET status = 'draft', posted_at = NULL WHERE id = ?").run(id);
  });
  tx();
}

/** Delete an invoice (and its lines and any batches it created), recomputing
 *  affected items. Atomic. */
export function deleteInvoice(db: DB, id: number): void {
  const tx = db.transaction(() => {
    const itemIds = (db.prepare("SELECT DISTINCT item_id AS id FROM item_purchases WHERE invoice_id = ?").all(id) as { id: number }[]).map((r) => r.id);
    db.prepare("DELETE FROM item_purchases WHERE invoice_id = ?").run(id);
    db.prepare("DELETE FROM invoices WHERE id = ?").run(id); // cascades invoice_lines
    for (const itemId of itemIds) recomputeItemTotals(db, itemId);
  });
  tx();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/db/invoices.test.ts && npx vitest run`
Expected: PASS (whole suite green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/invoices.ts tests/lib/db/invoices.test.ts
git commit -m "feat(db): unpostInvoice + deleteInvoice with item recompute"
```

---

### Task 7: `/api/invoices` route (list + create)

**Files:**
- Create: `src/app/api/invoices/route.ts`

No test (thin route).

- [ ] **Step 1: Create the route**

Create `src/app/api/invoices/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { createInvoice, listInvoices } from "@/lib/db/invoices";

export async function GET() {
  return NextResponse.json(listInvoices(getDb()));
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const id = createInvoice(getDb(), {
    supplier: typeof b.supplier === "string" ? b.supplier : null,
    invoiceDate: typeof b.invoiceDate === "string" ? b.invoiceDate : null,
    notes: typeof b.notes === "string" ? b.notes : null,
  });
  return NextResponse.json({ id });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/invoices/route.ts
git commit -m "feat(api): /api/invoices (list + create draft)"
```

---

### Task 8: `/api/invoices/[id]` route (get + update + delete)

**Files:**
- Create: `src/app/api/invoices/[id]/route.ts`

No test (thin route).

- [ ] **Step 1: Create the route**

Create `src/app/api/invoices/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { getInvoice, listInvoiceLines, updateInvoice, deleteInvoice } from "@/lib/db/invoices";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = getDb();
  const invoice = getInvoice(db, id);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ invoice, lines: listInvoiceLines(db, id) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = getDb();
  const inv = getInvoice(db, id);
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (inv.status !== "draft") return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 });
  const b = await req.json().catch(() => ({}));
  updateInvoice(db, id, {
    supplier: typeof b.supplier === "string" ? b.supplier : null,
    invoiceDate: typeof b.invoiceDate === "string" ? b.invoiceDate : null,
    notes: typeof b.notes === "string" ? b.notes : null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  deleteInvoice(getDb(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/invoices/[id]/route.ts"
git commit -m "feat(api): /api/invoices/[id] (get/update/delete)"
```

---

### Task 9: `/api/invoices/[id]/lines` route (add/edit/remove line)

**Files:**
- Create: `src/app/api/invoices/[id]/lines/route.ts`

No test (thin route).

- [ ] **Step 1: Create the route**

Create `src/app/api/invoices/[id]/lines/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { addInvoiceLine, updateInvoiceLine, deleteInvoiceLine } from "@/lib/db/invoices";

const qtyOk = (v: unknown) => Number.isInteger(Number(v)) && Number(v) >= 1;
const costOk = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0;
const itemIdOf = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const invoiceId = Number((await params).id);
  const b = await req.json();
  if (typeof b.productName !== "string" || !b.productName.trim() || !qtyOk(b.quantity) || !costOk(b.unitCostCents))
    return NextResponse.json({ error: "Invalid line" }, { status: 400 });
  try {
    const id = addInvoiceLine(getDb(), {
      invoiceId, itemId: itemIdOf(b.itemId), productName: b.productName.trim(),
      quantity: Math.trunc(Number(b.quantity)), unitCostCents: Math.trunc(Number(b.unitCostCents)),
    });
    return NextResponse.json({ id });
  } catch { return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 }); }
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!Number.isInteger(Number(b.id)) || typeof b.productName !== "string" || !b.productName.trim() || !qtyOk(b.quantity) || !costOk(b.unitCostCents))
    return NextResponse.json({ error: "Invalid line" }, { status: 400 });
  try {
    updateInvoiceLine(getDb(), Number(b.id), {
      itemId: itemIdOf(b.itemId), productName: b.productName.trim(),
      quantity: Math.trunc(Number(b.quantity)), unitCostCents: Math.trunc(Number(b.unitCostCents)),
    });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 }); }
}

export async function DELETE(req: NextRequest) {
  const b = await req.json();
  if (!Number.isInteger(Number(b.id))) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    deleteInvoiceLine(getDb(), Number(b.id));
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 }); }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/invoices/[id]/lines/route.ts"
git commit -m "feat(api): /api/invoices/[id]/lines (add/edit/remove)"
```

---

### Task 10: `/api/invoices/[id]/post` route (post + unpost)

**Files:**
- Create: `src/app/api/invoices/[id]/post/route.ts`

No test (thin route).

- [ ] **Step 1: Create the route**

Create `src/app/api/invoices/[id]/post/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { postInvoice, unpostInvoice } from "@/lib/db/invoices";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  try {
    postInvoice(getDb(), id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Cannot post" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  unpostInvoice(getDb(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/invoices/[id]/post/route.ts"
git commit -m "feat(api): /api/invoices/[id]/post (post + unpost)"
```

---

### Task 11: Nav link + invoices list page

**Files:**
- Modify: `src/components/Nav.tsx`
- Create: `src/app/invoices/page.tsx`
- Create: `src/components/NewInvoiceButton.tsx`

No test (UI).

- [ ] **Step 1: Add the nav link**

In `src/components/Nav.tsx`, change the `links` array to include Invoices after Inventory:

```ts
const links: [string, string][] = [
  ["/", "Dashboard"], ["/shows", "Shows"], ["/inventory", "Inventory"],
  ["/invoices", "Invoices"], ["/expenses", "Expenses"], ["/report", "Report"], ["/settings", "Settings"],
];
```

- [ ] **Step 2: Create the "New invoice" button**

Create `src/components/NewInvoiceButton.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

const today = () => new Date().toISOString().slice(0, 10);

/** Creates a blank draft invoice and navigates to its editor. */
export function NewInvoiceButton() {
  const router = useRouter();
  async function create() {
    const res = await fetch("/api/invoices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceDate: today() }),
    });
    if (!res.ok) return;
    const { id } = await res.json();
    router.push(`/invoices/${id}`);
  }
  return <Button onClick={create}>+ New invoice</Button>;
}
```

- [ ] **Step 3: Create the list page**

Create `src/app/invoices/page.tsx`:

```tsx
import Link from "next/link";
import { getDb } from "@/lib/db/connection";
import { listInvoices } from "@/lib/db/invoices";
import { Money } from "@/components/Money";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewInvoiceButton } from "@/components/NewInvoiceButton";

export const dynamic = "force-dynamic";

export default function InvoicesPage() {
  const invoices = listInvoices(getDb());
  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" subtitle="Purchase orders that stock your inventory" action={<NewInvoiceButton />} />
      {invoices.length === 0 ? (
        <p className="text-sm text-slate-500">No invoices yet. Create one to record a purchase.</p>
      ) : (
        <DataTable head={<>
          <th className="px-3 py-2">Number</th>
          <th className="px-3 py-2">Supplier</th>
          <th className="px-3 py-2">Date</th>
          <th className="px-3 py-2">Status</th>
          <th className="px-3 py-2 text-right">Total</th>
        </>}>
          {invoices.map((i) => (
            <tr key={i.id} className="border-t border-line">
              <td className="px-3 py-2"><Link href={`/invoices/${i.id}`} className="font-medium text-emerald-700 hover:underline">{i.number}</Link></td>
              <td className="px-3 py-2">{i.supplier ?? "—"}</td>
              <td className="px-3 py-2">{i.invoiceDate ?? "—"}</td>
              <td className="px-3 py-2"><Badge variant={i.status === "posted" ? "green" : "amber"}>{i.status}</Badge></td>
              <td className="px-3 py-2 text-right"><Money cents={i.total} /></td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Nav.tsx "src/app/invoices/page.tsx" src/components/NewInvoiceButton.tsx
git commit -m "feat(invoices): nav link + invoices list page"
```

---

### Task 12: `InvoiceDocument` + print page

**Files:**
- Create: `src/components/InvoiceDocument.tsx`
- Create: `src/app/invoices/[id]/print/page.tsx`

No test (presentational).

- [ ] **Step 1: Create the document component**

Create `src/components/InvoiceDocument.tsx` (plain component, renders in server and client):

```tsx
import { Money } from "@/components/Money";
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";

/** Read-only invoice document (header, line table, total). Used by the posted
 *  view and the print page. Shows a DRAFT marker when not yet posted. */
export function InvoiceDocument({ invoice, lines }: { invoice: Invoice; lines: InvoiceLine[] }) {
  const total = lines.reduce((s, l) => s + l.quantity * l.unitCostCents, 0);
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{invoice.number}</h1>
          {invoice.status === "draft" && <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">Draft</span>}
        </div>
        <div className="text-right text-sm text-slate-500">
          <div>{invoice.supplier ?? "—"}</div>
          <div>{invoice.invoiceDate ?? "—"}</div>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="py-1">Product</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Unit cost</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="py-1.5">{l.productName}</td>
              <td className="py-1.5 text-right tabular-nums">{l.quantity}</td>
              <td className="py-1.5 text-right tabular-nums"><Money cents={l.unitCostCents} /></td>
              <td className="py-1.5 text-right tabular-nums"><Money cents={l.quantity * l.unitCostCents} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold">
            <td className="py-1.5" colSpan={3}>Total</td>
            <td className="py-1.5 text-right"><Money cents={total} /></td>
          </tr>
        </tfoot>
      </table>

      {invoice.notes && <p className="text-sm text-slate-500">{invoice.notes}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create the print page**

Create `src/app/invoices/[id]/print/page.tsx`:

```tsx
import { getDb } from "@/lib/db/connection";
import { getInvoice, listInvoiceLines } from "@/lib/db/invoices";
import { InvoiceDocument } from "@/components/InvoiceDocument";

export const dynamic = "force-dynamic";

export default async function InvoicePrint({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = getDb();
  const invoice = getInvoice(db, id);
  if (!invoice) return <p className="p-8">Invoice not found.</p>;
  return (
    <div className="mx-auto max-w-2xl bg-white p-8">
      <InvoiceDocument invoice={invoice} lines={listInvoiceLines(db, id)} />
      <p className="mt-8 text-xs text-slate-400">Use your browser's print (Ctrl/Cmd+P) to save as PDF.</p>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/InvoiceDocument.tsx "src/app/invoices/[id]/print/page.tsx"
git commit -m "feat(invoices): printable InvoiceDocument + print page"
```

---

### Task 13: `InvoiceEditor` + `InvoiceActions`

**Files:**
- Create: `src/components/InvoiceActions.tsx`
- Create: `src/components/InvoiceEditor.tsx`

No test (client components).

- [ ] **Step 1: Create the actions bar**

Create `src/components/InvoiceActions.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/** Post / Unpost / Delete / Generate buttons for an invoice. */
export function InvoiceActions({ id, status, canPost }: { id: number; status: "draft" | "posted"; canPost: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(url, { method });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
      router.refresh();
    } catch { setError("Failed"); setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" href={`/invoices/${id}/print`}>Generate</Button>
      {status === "draft" ? (
        <Button disabled={busy || !canPost} onClick={() => call(`/api/invoices/${id}/post`, "POST")}>Post</Button>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => call(`/api/invoices/${id}/post`, "DELETE", "Unpost this invoice? Its stock will be removed from inventory.")}>Unpost</Button>
      )}
      <Button variant="danger" disabled={busy}
        onClick={async () => { if (!confirm("Delete this invoice? Any stock it added is removed.")) return; setBusy(true); const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" }); if (res.ok) router.push("/invoices"); else { setError("Failed"); setBusy(false); } }}>
        Delete
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Create the editor**

Create `src/components/InvoiceEditor.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Money } from "@/components/Money";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { toCents, toDollars } from "@/lib/money";
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";

export function InvoiceEditor({ invoice, lines: initialLines, items }: {
  invoice: Invoice; lines: InvoiceLine[]; items: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [supplier, setSupplier] = useState(invoice.supplier ?? "");
  const [date, setDate] = useState(invoice.invoiceDate ?? "");
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [lines, setLines] = useState<InvoiceLine[]>(initialLines);
  const [form, setForm] = useState({ itemId: "", name: "", qty: "", cost: "" });
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((s, l) => s + l.quantity * l.unitCostCents, 0);

  async function saveHeader() {
    await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplier: supplier || null, invoiceDate: date || null, notes: notes || null }),
    });
    router.refresh();
  }

  function pickItem(v: string) {
    const it = items.find((i) => String(i.id) === v);
    setForm({ ...form, itemId: v, name: it ? it.name : form.name });
  }

  async function addLine() {
    const qty = Math.trunc(Number(form.qty));
    const cents = toCents(Number(form.cost));
    const name = form.itemId ? (items.find((i) => String(i.id) === form.itemId)?.name ?? "") : form.name.trim();
    if (!name || !(qty >= 1) || !(cents >= 0)) { setError("Enter a product, quantity ≥ 1, and a cost."); return; }
    setError(null);
    const res = await fetch(`/api/invoices/${invoice.id}/lines`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: form.itemId || null, productName: name, quantity: qty, unitCostCents: cents }),
    });
    if (!res.ok) { setError("Could not add line."); return; }
    const { id } = await res.json();
    setLines([...lines, { id, invoiceId: invoice.id, itemId: form.itemId ? Number(form.itemId) : null, productName: name, quantity: qty, unitCostCents: cents }]);
    setForm({ itemId: "", name: "", qty: "", cost: "" });
  }

  async function removeLine(id: number) {
    const res = await fetch(`/api/invoices/${invoice.id}/lines`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (res.ok) setLines(lines.filter((l) => l.id !== id));
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3">
        <input className={INPUT_CLASS} placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} onBlur={saveHeader} />
        <input type="date" className={INPUT_CLASS} value={date} onChange={(e) => setDate(e.target.value)} onBlur={saveHeader} />
        <input className={INPUT_CLASS} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveHeader} />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="py-1">Product</th><th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Unit cost</th><th className="py-1 text-right">Total</th><th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="py-1.5">{l.productName}</td>
              <td className="py-1.5 text-right tabular-nums">{l.quantity}</td>
              <td className="py-1.5 text-right tabular-nums"><Money cents={l.unitCostCents} /></td>
              <td className="py-1.5 text-right tabular-nums"><Money cents={l.quantity * l.unitCostCents} /></td>
              <td className="py-1.5 text-right"><button onClick={() => removeLine(l.id)} className="text-xs text-red-600 hover:underline">✕</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold"><td colSpan={3} className="py-1.5">Total</td><td className="py-1.5 text-right"><Money cents={total} /></td><td /></tr>
        </tfoot>
      </table>

      <div className="rounded-xl border border-line p-3">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Add a line</p>
        <div className="flex flex-wrap items-end gap-2">
          <select className={INPUT_CLASS} value={form.itemId} onChange={(e) => pickItem(e.target.value)}>
            <option value="">New product…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          {!form.itemId && <input className={INPUT_CLASS} placeholder="New product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          <input type="number" min="1" placeholder="Qty" className={`w-20 ${INPUT_CLASS}`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          <input type="number" step="0.01" min="0" placeholder="Unit cost $" className={`w-28 ${INPUT_CLASS}`} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          <Button onClick={addLine}>Add</Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

(`toDollars` is imported for symmetry with other editors; if your linter flags it as unused, remove it from the import.)

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/InvoiceActions.tsx src/components/InvoiceEditor.tsx
git commit -m "feat(invoices): InvoiceEditor (draft) + InvoiceActions"
```

---

### Task 14: Invoice page (editor vs document)

**Files:**
- Create: `src/app/invoices/[id]/page.tsx`

No test (UI).

- [ ] **Step 1: Create the page**

Create `src/app/invoices/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { getDb } from "@/lib/db/connection";
import { getInvoice, listInvoiceLines } from "@/lib/db/invoices";
import { listItems } from "@/lib/db/inventory";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { InvoiceActions } from "@/components/InvoiceActions";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = getDb();
  const invoice = getInvoice(db, id);
  if (!invoice) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Invoice not found</h1>
        <Link className="text-emerald-700 hover:underline" href="/invoices">← Invoices</Link>
      </div>
    );
  }
  const lines = listInvoiceLines(db, id);
  const items = listItems(db).map((i) => ({ id: i.id, name: i.name }));

  return (
    <div className="space-y-6">
      <PageHeader title={invoice.number}
        subtitle={invoice.status === "draft" ? "Draft — add lines, then Post to stock inventory" : "Posted to inventory"}
        action={<Link className="text-sm text-emerald-700 hover:underline" href="/invoices">← Invoices</Link>} />

      <InvoiceActions id={invoice.id} status={invoice.status} canPost={lines.length > 0} />

      <Card title={invoice.status === "draft" ? "Edit invoice" : "Invoice"}>
        {invoice.status === "draft"
          ? <InvoiceEditor invoice={invoice} lines={lines} items={items} />
          : <InvoiceDocument invoice={invoice} lines={lines} />}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles + build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/invoices/[id]/page.tsx"
git commit -m "feat(invoices): invoice page — editor for drafts, document for posted"
```

---

### Task 15: Link batches to invoices on the item detail page + sweep

**Files:**
- Modify: `src/components/PurchaseList.tsx`
- Modify: `src/app/inventory/[id]/page.tsx`

- [ ] **Step 1: Add an optional invoice link to PurchaseList**

In `src/components/PurchaseList.tsx`:

1. Add `import Link from "next/link";` at the top.
2. Extend `PurchaseRow`:

```tsx
export interface PurchaseRow { id: number; purchasedOn: string | null; quantity: number; unitCostCents: number; invoiceId?: number | null; invoiceNumber?: string | null; }
```

3. Add a "Source" column. In the `<thead>` add `<th className="py-1">Source</th>` before the editable header cell, and in each body row add this cell before the editable `<td>`:

```tsx
            <td className="py-1.5 text-xs">
              {p.invoiceId ? <Link href={`/invoices/${p.invoiceId}`} className="text-emerald-700 hover:underline">{p.invoiceNumber}</Link> : <span className="text-slate-400">—</span>}
            </td>
```

Also add an empty `<td />` in the `<tfoot>` row to keep column counts aligned, and add `<th className="py-1" />`-style spacing only if needed (match the existing column count). Keep the existing `editable` column logic.

- [ ] **Step 2: Pass invoice info from the item detail page**

In `src/app/inventory/[id]/page.tsx`, update the `purchases` mapping (the line added in the purchase-batches feature) to include invoice info. Add `import { invoiceNumber } from "@/lib/db/invoices";` at the top, then:

```tsx
  const purchases = listPurchases(db, itemId).map((p) => ({
    id: p.id, purchasedOn: p.purchasedOn, quantity: p.quantity, unitCostCents: p.unitCostCents,
    invoiceId: p.invoiceId, invoiceNumber: p.invoiceId ? invoiceNumber(p.invoiceId) : null,
  }));
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Full verification sweep**

Run: `npx vitest run`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/PurchaseList.tsx "src/app/inventory/[id]/page.tsx"
git commit -m "feat(inventory): link purchase batches to their invoice"
```
