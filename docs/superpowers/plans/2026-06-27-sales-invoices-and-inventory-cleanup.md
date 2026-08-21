# Sales Invoices (Wholesale) + Inventory Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add outbound *sales invoices* (the mechanism for wholesale sales) and clean up the inventory mental model (transparent remaining, a unified adjustments log, no negatives, loud alias mapping).

**Architecture:** Extend the existing purchase-invoice system with a `direction` dimension (`purchase` | `sale`). A sale invoice reduces stock when **posted** and contributes revenue/profit only when **paid**. Replace the `qty_samples`/`qty_adjustment` columns with an `inventory_adjustments` log feeding a transparent `remaining` calc. Wholesale (paid) rolls into the existing per-show profit report.

**Tech Stack:** Next.js App Router (RSC + client components), TypeScript, better-sqlite3, Tailwind, Vitest. Money is integer cents rendered via `<Money>`.

## Global Constraints

- Money is integer cents; render via `<Money>` (`src/components/Money.tsx`). Quantities are integer pieces.
- DB migrations are **idempotent column adds / `CREATE TABLE IF NOT EXISTS`** inside `migrate()` in `src/lib/db/connection.ts` (SQLite has no `ADD COLUMN IF NOT EXISTS`; guard on `PRAGMA table_info`).
- Tests use Vitest with `createDb(":memory:")` and the `@/` path alias; run with `npx vitest run <path>`.
- No new heavy dependencies. PDF = browser print. Comboboxes stay native.
- Don't regress purchase invoices: every existing test in `tests/lib/db/invoices.test.ts` must still pass. `direction` defaults to `'purchase'`.
- Tailwind mobile-first; reuse `Badge`, `Button`, `Card`, `DataTable`, `Money`, `Stat`, `PageHeader`, `INPUT_CLASS`.
- Owner/partner split (`splitProfit`, `owner_share_pct`) applies to wholesale profit like show profit.

---

## Phase 1 — Inventory cleanup foundation (schema + calc)

### Task 1: Schema + migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/connection.ts` (`migrate()`)
- Test: `tests/lib/db/migrate-adjustments.test.ts` (create)

**Interfaces:**
- Produces: `inventory_adjustments(id, item_id, adjusted_on, reason, qty, note)`; new columns `invoices.direction`, `invoices.customer`, `invoices.paid`, `invoices.paid_on`, `invoice_lines.unit_price_cents`. After migration, existing `qty_samples`/`qty_adjustment` values are mirrored into adjustment rows.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/db/migrate-adjustments.test.ts
import { describe, it, expect } from "vitest";
import { createDb, migrateAdjustments, type DB } from "@/lib/db/connection";
import { insertItem, qtyRemaining } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { sumAdjustments } from "@/lib/db/adjustments";

describe("adjustments schema + migration", () => {
  it("fresh db has inventory_adjustments and the new invoice columns", () => {
    const db: DB = createDb(":memory:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain("inventory_adjustments");
    const inv = (db.prepare("PRAGMA table_info(invoices)").all() as any[]).map((c) => c.name);
    expect(inv).toEqual(expect.arrayContaining(["direction", "customer", "paid", "paid_on"]));
    const lines = (db.prepare("PRAGMA table_info(invoice_lines)").all() as any[]).map((c) => c.name);
    expect(lines).toContain("unit_price_cents");
  });

  it("mirrors legacy qty_samples / qty_adjustment into adjustment rows once, then zeroes them", () => {
    const db: DB = createDb(":memory:");                 // fresh schema still has the legacy columns
    const a = insertItem(db, { name: "A", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: a, purchasedOn: null, quantity: 100, unitCostCents: 0 });
    // simulate a pre-migration DB by writing the legacy columns directly
    db.prepare("UPDATE inventory_items SET qty_samples = 3, qty_adjustment = -2 WHERE id = ?").run(a);

    migrateAdjustments(db);

    const rows = db.prepare("SELECT reason, qty FROM inventory_adjustments WHERE item_id=? ORDER BY reason").all(a);
    expect(rows).toEqual([{ reason: "recount", qty: -2 }, { reason: "sample", qty: -3 }]);
    expect(sumAdjustments(db, a)).toBe(-5);
    expect(qtyRemaining(db, a)).toBe(95);               // 100 - 0 sold - 5; legacy columns now zeroed (no double count)

    migrateAdjustments(db);                              // idempotent
    expect((db.prepare("SELECT COUNT(*) n FROM inventory_adjustments WHERE item_id=?").get(a) as any).n).toBe(2);
  });
});
```

> This test depends on Task 2's `sumAdjustments` and the rewired `qtyRemaining`. If implementing strictly in order, write only the first `it` block in Task 1 and add the second `it` after Task 2 (or run this file at the end of Task 2).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/migrate-adjustments.test.ts`
Expected: FAIL (table/columns/`migrateAdjustments` missing).

- [ ] **Step 3: Add schema pieces**

In `src/lib/db/schema.ts`, add to the `SCHEMA` string: the new columns on `invoices` and `invoice_lines` (so fresh DBs have them), and the new table. Add inside the template literal:

```sql
-- (add to the invoices CREATE TABLE) :
--   direction TEXT NOT NULL DEFAULT 'purchase' CHECK (direction IN ('purchase','sale')),
--   customer TEXT,
--   paid INTEGER NOT NULL DEFAULT 0,
--   paid_on TEXT,
-- (add to the invoice_lines CREATE TABLE) :
--   unit_price_cents INTEGER,

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  adjusted_on TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('sample','damage_loss','recount','other')),
  qty INTEGER NOT NULL,
  note TEXT
);
```

Edit the `invoices` and `invoice_lines` `CREATE TABLE` blocks in `schema.ts` to include the commented columns above.

- [ ] **Step 4: Add idempotent migration**

In `src/lib/db/connection.ts`, inside `migrate()` add guarded column adds and the table, then call `migrateAdjustments(db)`. Export `migrateAdjustments`:

```ts
// inside migrate(), after existing blocks:
const icols = (db.prepare("PRAGMA table_info(invoices)").all() as { name: string }[]).map((c) => c.name);
if (!icols.includes("direction")) db.exec("ALTER TABLE invoices ADD COLUMN direction TEXT NOT NULL DEFAULT 'purchase'");
if (!icols.includes("customer")) db.exec("ALTER TABLE invoices ADD COLUMN customer TEXT");
if (!icols.includes("paid")) db.exec("ALTER TABLE invoices ADD COLUMN paid INTEGER NOT NULL DEFAULT 0");
if (!icols.includes("paid_on")) db.exec("ALTER TABLE invoices ADD COLUMN paid_on TEXT");
const lcols = (db.prepare("PRAGMA table_info(invoice_lines)").all() as { name: string }[]).map((c) => c.name);
if (!lcols.includes("unit_price_cents")) db.exec("ALTER TABLE invoice_lines ADD COLUMN unit_price_cents INTEGER");
db.exec(`CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  adjusted_on TEXT, reason TEXT NOT NULL CHECK (reason IN ('sample','damage_loss','recount','other')), qty INTEGER NOT NULL, note TEXT)`);
migrateAdjustments(db);
```

```ts
/** One-time, idempotent: mirror legacy qty_samples (as negative 'sample') and
 *  qty_adjustment (sign-preserved 'recount') into inventory_adjustments, then zero
 *  the legacy columns so remaining (now read from the log) isn't double-counted.
 *  Guarded per-item on a marker: skip items that already have a migrated row. */
export function migrateAdjustments(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(inventory_items)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("qty_samples")) return;
  const items = db.prepare("SELECT id, qty_samples AS s, qty_adjustment AS a FROM inventory_items WHERE qty_samples <> 0 OR qty_adjustment <> 0").all() as { id: number; s: number; a: number }[];
  const insert = db.prepare("INSERT INTO inventory_adjustments (item_id, adjusted_on, reason, qty, note) VALUES (?,?,?,?,?)");
  const tx = db.transaction(() => {
    for (const it of items) {
      if (it.s !== 0) insert.run(it.id, null, "sample", -it.s, "migrated from qty_samples");
      if (it.a !== 0) insert.run(it.id, null, "recount", it.a, "migrated from qty_adjustment");
      db.prepare("UPDATE inventory_items SET qty_samples = 0, qty_adjustment = 0 WHERE id = ?").run(it.id);
    }
  });
  tx();
}
```

> Note: zeroing the legacy columns after mirroring is what makes it idempotent (the `WHERE ... <> 0` filter finds nothing on re-run). The test calls `migrateAdjustments` directly; in production it runs from `migrate()`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/migrate-adjustments.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts tests/lib/db/migrate-adjustments.test.ts
git commit -m "feat(db): adjustments log + sales-invoice columns, with migration"
```

---

### Task 2: Adjustments DB layer + transparent remaining

**Files:**
- Create: `src/lib/db/adjustments.ts`
- Modify: `src/lib/db/inventory.ts` (`qtyRemaining`, `setItemRemaining`; remove `updateItemSamples` reliance on the column)
- Test: `tests/lib/db/adjustments.test.ts` (create); extend `tests/lib/db/inventory.test.ts`

**Interfaces:**
- Produces:
  - `interface Adjustment { id: number; itemId: number; adjustedOn: string | null; reason: "sample"|"damage_loss"|"recount"|"other"; qty: number; note: string | null }`
  - `listAdjustments(db, itemId): Adjustment[]`
  - `addAdjustment(db, { itemId, adjustedOn, reason, qty, note }): number`
  - `deleteAdjustment(db, id): void`
  - `sumAdjustments(db, itemId): number`
- Consumes: `DB` from `./connection`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/db/adjustments.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, qtyRemaining } from "@/lib/db/inventory";
import { addAdjustment, listAdjustments, deleteAdjustment, sumAdjustments } from "@/lib/db/adjustments";
import { addPurchase } from "@/lib/db/purchases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

it("adjustments reduce/raise remaining and sum correctly", () => {
  const a = insertItem(db, { name: "A", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: a, purchasedOn: null, quantity: 100, unitCostCents: 50 });
  addAdjustment(db, { itemId: a, adjustedOn: "2026-06-12", reason: "sample", qty: -2, note: null });
  addAdjustment(db, { itemId: a, adjustedOn: "2026-06-18", reason: "damage_loss", qty: -4, note: "crushed" });
  expect(sumAdjustments(db, a)).toBe(-6);
  expect(qtyRemaining(db, a)).toBe(94);          // 100 - 0 sold - 6
  expect(listAdjustments(db, a)).toHaveLength(2);
});

it("deleteAdjustment restores remaining", () => {
  const a = insertItem(db, { name: "A", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: a, purchasedOn: null, quantity: 10, unitCostCents: 0 });
  const id = addAdjustment(db, { itemId: a, adjustedOn: null, reason: "recount", qty: -3, note: null });
  expect(qtyRemaining(db, a)).toBe(7);
  deleteAdjustment(db, id);
  expect(qtyRemaining(db, a)).toBe(10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/adjustments.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `adjustments.ts`**

```ts
// src/lib/db/adjustments.ts
import type { DB } from "./connection";

export type AdjustReason = "sample" | "damage_loss" | "recount" | "other";
export interface Adjustment { id: number; itemId: number; adjustedOn: string | null; reason: AdjustReason; qty: number; note: string | null; }

export function listAdjustments(db: DB, itemId: number): Adjustment[] {
  return db.prepare(
    "SELECT id, item_id AS itemId, adjusted_on AS adjustedOn, reason, qty, note FROM inventory_adjustments WHERE item_id = ? ORDER BY adjusted_on, id"
  ).all(itemId) as Adjustment[];
}

export function addAdjustment(db: DB, a: { itemId: number; adjustedOn: string | null; reason: AdjustReason; qty: number; note: string | null }): number {
  const info = db.prepare(
    "INSERT INTO inventory_adjustments (item_id, adjusted_on, reason, qty, note) VALUES (?,?,?,?,?)"
  ).run(a.itemId, a.adjustedOn, a.reason, a.qty, a.note);
  return Number(info.lastInsertRowid);
}

export function deleteAdjustment(db: DB, id: number): void {
  db.prepare("DELETE FROM inventory_adjustments WHERE id = ?").run(id);
}

export function sumAdjustments(db: DB, itemId: number): number {
  const r = db.prepare("SELECT COALESCE(SUM(qty),0) AS s FROM inventory_adjustments WHERE item_id = ?").get(itemId) as { s: number };
  return Number(r.s);
}
```

- [ ] **Step 4: Rewire `qtyRemaining` and `setItemRemaining` in `inventory.ts`**

Replace the `qty_samples`/`qty_adjustment` arithmetic with the adjustments log. Update `qtyRemaining`:

```ts
import { sumAdjustments, addAdjustment } from "./adjustments";

export function qtyRemaining(db: DB, itemId: number): number {
  const item = db.prepare("SELECT qty_purchased as q FROM inventory_items WHERE id = ?").get(itemId) as { q: number } | undefined;
  if (!item) return 0;
  return Number(item.q) - qtySold(db, itemId) + sumAdjustments(db, itemId);
}
```

Reimplement `setItemRemaining` to write a `recount` adjustment for the delta instead of touching `qty_adjustment`:

```ts
/** Set remaining to `target` by appending a 'recount' adjustment for the difference.
 *  Never touches cost/COGS/spend. */
export function setItemRemaining(db: DB, id: number, target: number): void {
  const current = qtyRemaining(db, id);
  const delta = target - current;
  if (delta !== 0) addAdjustment(db, { itemId: id, adjustedOn: new Date().toISOString().slice(0, 10), reason: "recount", qty: delta, note: null });
}
```

Leave `updateItemSamples` in place but stop using it from the UI (Task 12 removes its call site); it no longer affects remaining. Update its doc comment to note it is deprecated.

- [ ] **Step 5: Update the existing inventory test for the new model**

In `tests/lib/db/inventory.test.ts`, any test asserting `setItemRemaining`/samples behavior must now expect the adjustments-log semantics (remaining = purchased − sold + Σ adjustments). Run the file, read failures, and adjust expectations (the *numbers* are unchanged for `setItemRemaining`; only the storage moved).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib/db/adjustments.test.ts tests/lib/db/inventory.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/adjustments.ts src/lib/db/inventory.ts tests/lib/db/adjustments.test.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): remaining reads from adjustments log"
```

---

### Task 3: Wholesale sold-source

**Files:**
- Modify: `src/lib/db/inventory.ts` (`qtySoldWholesale`, fold into `qtySold`)
- Test: extend `tests/lib/db/inventory.test.ts`

**Interfaces:**
- Produces: `qtySoldWholesale(db, itemId): number` = Σ `invoice_lines.quantity` for posted sale invoices. Folded into `qtySold`.
- Depends on Task 4 only at the data level (uses `invoices.direction`/`status`), which exists after Task 1's schema. Safe to implement now since the columns exist.

- [ ] **Step 1: Write the failing test**

```ts
it("wholesale: a posted sale invoice line counts as sold", () => {
  const a = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: a, purchasedOn: null, quantity: 100, unitCostCents: 50 });
  // raw sale invoice (Task 4 adds the typed helper; here exercise the column contract)
  const invId = Number(db.prepare("INSERT INTO invoices (direction, customer, invoice_date, status) VALUES ('sale','Joe','2026-06-27','posted')").run().lastInsertRowid);
  db.prepare("INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents, unit_price_cents) VALUES (?,?,?,?,?,?)")
    .run(invId, a, "A", 24, 0, 300);
  expect(qtySoldWholesale(db, a)).toBe(24);
  expect(qtyRemaining(db, a)).toBe(76);          // 100 - 24
});

it("wholesale: a DRAFT sale invoice line does not count", () => {
  const a = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: a, purchasedOn: null, quantity: 100, unitCostCents: 50 });
  const invId = Number(db.prepare("INSERT INTO invoices (direction, status) VALUES ('sale','draft')").run().lastInsertRowid);
  db.prepare("INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents, unit_price_cents) VALUES (?,?,?,?,?,?)").run(invId, a, "A", 5, 0, 100);
  expect(qtySoldWholesale(db, a)).toBe(0);
  expect(qtyRemaining(db, a)).toBe(100);
});
```

Add `qtySoldWholesale` to the import in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: FAIL (`qtySoldWholesale` not defined).

- [ ] **Step 3: Implement**

```ts
/** Units sold wholesale: Σ qty of lines on POSTED sale invoices. Stock leaves at
 *  post regardless of paid status (revenue recognition is separate — see report). */
export function qtySoldWholesale(db: DB, itemId: number): number {
  const r = db.prepare(`SELECT COALESCE(SUM(il.quantity),0) AS q FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE il.item_id = ? AND i.direction = 'sale' AND i.status = 'posted'`).get(itemId) as { q: number };
  return Number(r.q);
}
```

Fold into `qtySold`:

```ts
export function qtySold(db: DB, itemId: number): number {
  return qtySoldFromLedger(db, itemId) + qtySoldByItem(db, itemId) + qtyGivenToBrother(db, itemId) + qtySoldWholesale(db, itemId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): posted sale invoices reduce stock"
```

---

## Phase 2 — Sales invoices (DB + report)

### Task 4: Extend invoices repo for direction / customer / paid

**Files:**
- Modify: `src/lib/db/invoices.ts`
- Test: extend `tests/lib/db/invoices.test.ts`

**Interfaces:**
- Produces (extended types & helpers):
  - `Invoice` gains `direction: "purchase"|"sale"`, `customer: string | null`, `paid: boolean`, `paidOn: string | null`.
  - `InvoiceLine` gains `unitPriceCents: number | null`.
  - `createInvoice(db, { direction?, supplier?, customer?, invoiceDate, notes })` — `direction` defaults `'purchase'`.
  - `addInvoiceLine` / `updateInvoiceLine` accept `unitPriceCents: number | null`.
  - `setInvoicePaid(db, id, paid: boolean, paidOn: string | null)`.
  - `lineAmountCents(line)` = `direction === 'sale' ? quantity*unitPriceCents : quantity*unitCostCents` (compute in SQL for `total`).

- [ ] **Step 1: Write the failing tests**

```ts
it("createInvoice supports a sale with a customer; total uses unit price", () => {
  const id = createInvoice(db, { direction: "sale", customer: "Joe's Card Shop", invoiceDate: "2026-06-27", notes: null });
  const item = insertItem(db, { name: "Pack", unitCostCents: 175, qtyPurchased: 0, lotId: null });
  addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: 24, unitCostCents: 0, unitPriceCents: 300 });
  const inv = getInvoice(db, id)!;
  expect(inv).toMatchObject({ direction: "sale", customer: "Joe's Card Shop", paid: false });
  expect(inv.total).toBe(24 * 300);
  expect(listInvoiceLines(db, id)[0].unitPriceCents).toBe(300);
});

it("setInvoicePaid toggles paid + paidOn", () => {
  const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
  setInvoicePaid(db, id, true, "2026-06-28");
  expect(getInvoice(db, id)).toMatchObject({ paid: true, paidOn: "2026-06-28" });
  setInvoicePaid(db, id, false, null);
  expect(getInvoice(db, id)).toMatchObject({ paid: false, paidOn: null });
});

it("purchase invoices still default direction and total off unit cost", () => {
  const id = createInvoice(db, { supplier: "Co", invoiceDate: "2026-06-15", notes: null });
  expect(getInvoice(db, id)).toMatchObject({ direction: "purchase", paid: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the extensions**

Update the interfaces, `SELECT`/`hydrate`, `createInvoice`, line helpers, and add `setInvoicePaid`:

```ts
export interface Invoice {
  id: number; number: string; direction: "purchase" | "sale";
  supplier: string | null; customer: string | null; invoiceDate: string | null;
  notes: string | null; status: "draft" | "posted"; postedAt: string | null;
  paid: boolean; paidOn: string | null; total: number;
}
export interface InvoiceLine {
  id: number; invoiceId: number; itemId: number | null; productName: string;
  quantity: number; unitCostCents: number; unitPriceCents: number | null;
}

const SELECT = `
  SELECT i.id, i.direction, i.supplier, i.customer, i.invoice_date AS invoiceDate, i.notes,
    i.status, i.posted_at AS postedAt, i.paid, i.paid_on AS paidOn,
    COALESCE((SELECT SUM(quantity * CASE WHEN i.direction='sale' THEN COALESCE(unit_price_cents,0) ELSE unit_cost_cents END)
              FROM invoice_lines WHERE invoice_id = i.id), 0) AS total
  FROM invoices i`;

function hydrate(row: any): Invoice {
  return { ...row, number: invoiceNumber(row.id), paid: !!row.paid, total: Number(row.total) };
}

export function createInvoice(db: DB, p: { direction?: "purchase" | "sale"; supplier?: string | null; customer?: string | null; invoiceDate: string | null; notes: string | null }): number {
  const info = db.prepare("INSERT INTO invoices (direction, supplier, customer, invoice_date, notes) VALUES (?,?,?,?,?)")
    .run(p.direction ?? "purchase", p.supplier ?? null, p.customer ?? null, p.invoiceDate, p.notes);
  return Number(info.lastInsertRowid);
}

export function setInvoicePaid(db: DB, id: number, paid: boolean, paidOn: string | null): void {
  db.prepare("UPDATE invoices SET paid = ?, paid_on = ? WHERE id = ?").run(paid ? 1 : 0, paid ? paidOn : null, id);
}
```

Update `updateInvoice` to also persist `customer`. Update `listInvoiceLines`, `addInvoiceLine`, `updateInvoiceLine` to select/accept `unit_price_cents` (add the column to the SQL and the param lists; default `null`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: PASS (including the pre-existing purchase tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/invoices.ts tests/lib/db/invoices.test.ts
git commit -m "feat(invoices): direction, customer, paid, sale line prices"
```

---

### Task 5: Post a sale invoice (oversell guard, no batches)

**Files:**
- Modify: `src/lib/db/invoices.ts` (`postInvoice` branches on direction; `unpostInvoice` handles sales)
- Test: extend `tests/lib/db/invoices.test.ts`

**Interfaces:**
- Consumes: `qtyRemaining` from `inventory.ts`.
- Produces: `postInvoice` for a `sale` validates every line resolves to an item, blocks overselling, and flips status to `posted` **without** creating purchase batches (stock drops via Task 3's query). `unpostInvoice` of a sale just reverts status to draft (stock returns automatically).

- [ ] **Step 1: Write the failing tests**

```ts
import { qtyRemaining } from "@/lib/db/inventory";

it("posting a sale reduces remaining and creates no purchase batch", () => {
  const item = insertItem(db, { name: "Pack", unitCostCents: 175, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: item, purchasedOn: null, quantity: 100, unitCostCents: 175 });
  const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
  addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: 24, unitCostCents: 0, unitPriceCents: 300 });
  postInvoice(db, id);
  expect(getInvoice(db, id)!.status).toBe("posted");
  expect(qtyRemaining(db, item)).toBe(76);
  expect(listPurchases(db, item)).toHaveLength(1); // unchanged: only the original purchase batch
});

it("posting a sale that oversells is blocked", () => {
  const item = insertItem(db, { name: "Pack", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: item, purchasedOn: null, quantity: 10, unitCostCents: 0 });
  const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
  addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: 30, unitCostCents: 0, unitPriceCents: 100 });
  expect(() => postInvoice(db, id)).toThrow(/only 10/i);
  expect(getInvoice(db, id)!.status).toBe("draft");
});

it("a sale line with no item is rejected at post", () => {
  const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
  addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "Mystery", quantity: 1, unitCostCents: 0, unitPriceCents: 100 });
  expect(() => postInvoice(db, id)).toThrow(/must map to an item/i);
});

it("unpost of a sale returns the stock", () => {
  const item = insertItem(db, { name: "Pack", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: item, purchasedOn: null, quantity: 50, unitCostCents: 0 });
  const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
  addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: 20, unitCostCents: 0, unitPriceCents: 100 });
  postInvoice(db, id);
  expect(qtyRemaining(db, item)).toBe(30);
  unpostInvoice(db, id);
  expect(getInvoice(db, id)!.status).toBe("draft");
  expect(qtyRemaining(db, item)).toBe(50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: FAIL.

- [ ] **Step 3: Branch `postInvoice` / `unpostInvoice` on direction**

```ts
import { qtyRemaining } from "./inventory";

export function postInvoice(db: DB, id: number): void {
  const tx = db.transaction(() => {
    const inv = db.prepare("SELECT status, direction, invoice_date AS invoiceDate FROM invoices WHERE id = ?").get(id) as { status: string; direction: string; invoiceDate: string | null } | undefined;
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "draft") throw new Error("Invoice is already posted");
    const lines = listInvoiceLines(db, id);
    if (lines.length === 0) throw new Error("Cannot post an empty invoice");

    if (inv.direction === "sale") {
      // Validate items + stock BEFORE flipping status (qtySoldWholesale counts posted lines).
      for (const line of lines) {
        if (line.itemId == null) throw new Error(`Line "${line.productName}" must map to an item before posting a sale`);
        const remaining = qtyRemaining(db, line.itemId);
        if (line.quantity > remaining) {
          const nm = db.prepare("SELECT name FROM inventory_items WHERE id = ?").get(line.itemId) as { name: string };
          throw new Error(`Can't sell ${line.quantity} — only ${remaining} of "${nm.name}" remain`);
        }
      }
      db.prepare("UPDATE invoices SET status = 'posted', posted_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      return; // sales create NO purchase batches; stock drops via qtySoldWholesale
    }

    // purchase path (unchanged)
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

For `unpostInvoice`, branch: if the invoice is a sale, just set status back to draft + clear `posted_at` (no batches to remove). Keep the existing purchase logic for purchases. Guard `deleteInvoice` similarly (a sale has no batches; deleting the rows is enough — the existing batch-deletion is a no-op for sales).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/invoices.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/invoices.ts tests/lib/db/invoices.test.ts
git commit -m "feat(invoices): post/unpost sale invoices with oversell guard"
```

---

### Task 6: Wholesale rollup in the profit report

**Files:**
- Modify: `src/lib/calc/ledger-report.ts`
- Test: `tests/lib/calc/wholesale-report.test.ts` (create)

**Interfaces:**
- Produces: `LedgerReport` gains a `wholesale` block and folds **paid** sale profit into `totals`:
  ```ts
  interface WholesaleInvoiceLine { invoiceId: number; number: string; customer: string | null; paid: boolean; qty: number; revenueCents: number; cogsCents: number; profitCents: number; }
  interface WholesaleRollup { invoices: WholesaleInvoiceLine[]; paidRevenueCents: number; paidCogsCents: number; paidProfitCents: number; owedToYouCents: number; }
  ```
  `totals.revenueCents`/`cogsCents`/`netCents` include **paid** wholesale; `unitsSold` includes paid wholesale qty. Owner split recomputed off the new `netCents`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/calc/wholesale-report.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { createInvoice, addInvoiceLine, postInvoice, setInvoicePaid } from "@/lib/db/invoices";
import { buildLedgerReport } from "@/lib/calc/ledger-report";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

function saleOf(item: number, qty: number, priceCents: number, paid: boolean) {
  const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
  addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: qty, unitCostCents: 0, unitPriceCents: priceCents });
  postInvoice(db, id);
  if (paid) setInvoicePaid(db, id, true, "2026-06-28");
  return id;
}

it("only PAID wholesale counts toward profit; unpaid sits in owedToYou", () => {
  const item = insertItem(db, { name: "Pack", unitCostCents: 175, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: item, purchasedOn: null, quantity: 100, unitCostCents: 175 });
  saleOf(item, 24, 300, true);   // revenue 7200, cogs 24*175=4200, profit 3000
  saleOf(item, 10, 300, false);  // unpaid -> owed 3000, excluded from profit

  const rep = buildLedgerReport(db);
  expect(rep.wholesale.paidRevenueCents).toBe(7200);
  expect(rep.wholesale.paidCogsCents).toBe(4200);
  expect(rep.wholesale.paidProfitCents).toBe(3000);
  expect(rep.wholesale.owedToYouCents).toBe(3000);
  expect(rep.totals.revenueCents).toBe(7200);
  expect(rep.totals.cogsCents).toBe(4200);
  expect(rep.totals.netCents).toBe(3000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/wholesale-report.test.ts`
Expected: FAIL (`rep.wholesale` undefined).

- [ ] **Step 3: Implement the rollup**

In `ledger-report.ts`, after the per-show loop and before computing `totals`, build the wholesale rollup from sale invoices, using each item's current avg unit cost (the same `itemCost` map already built). Add the types to the exports, compute `wholesale`, then **add paid wholesale into** `revenueCents`, `cogsCents`, `netCents`, `unitsSold` before `splitProfit`:

```ts
// build wholesale rollup
const saleInvoices = db.prepare(
  "SELECT id, customer, paid FROM invoices WHERE direction='sale' AND status='posted' ORDER BY id DESC"
).all() as { id: number; customer: string | null; paid: number }[];
const wholesaleInvoices = saleInvoices.map((inv) => {
  const lines = db.prepare("SELECT item_id AS itemId, quantity, unit_price_cents AS price FROM invoice_lines WHERE invoice_id = ?").all(inv.id) as { itemId: number; quantity: number; price: number }[];
  let qty = 0, revenue = 0, cogs = 0;
  for (const l of lines) { qty += l.quantity; revenue += l.quantity * (l.price ?? 0); cogs += l.quantity * (itemCost.get(l.itemId) ?? 0); }
  return { invoiceId: inv.id, number: invoiceNumber(inv.id), customer: inv.customer, paid: !!inv.paid, qty, revenueCents: revenue, cogsCents: cogs, profitCents: revenue - cogs };
});
const paid = wholesaleInvoices.filter((w) => w.paid);
const wholesale = {
  invoices: wholesaleInvoices,
  paidRevenueCents: paid.reduce((s, w) => s + w.revenueCents, 0),
  paidCogsCents: paid.reduce((s, w) => s + w.cogsCents, 0),
  paidProfitCents: paid.reduce((s, w) => s + w.profitCents, 0),
  owedToYouCents: wholesaleInvoices.filter((w) => !w.paid).reduce((s, w) => s + w.revenueCents, 0),
};
```

Then fold paid wholesale into the totals (add `wholesale.paidRevenueCents` to `revenueCents`, `wholesale.paidCogsCents` to `cogsCents`, `wholesale.paidProfitCents` to `netCents`, and the paid qty to `unitsSold`) and recompute `splitProfit(netCents, ...)`. Import `invoiceNumber` from `@/lib/db/invoices`. Add `wholesale` to the returned object and the `LedgerReport` interface.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/wholesale-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calc/ledger-report.ts tests/lib/calc/wholesale-report.test.ts
git commit -m "feat(report): fold paid wholesale into profit totals + rollup"
```

---

## Phase 3 — API

### Task 7: Invoices API — direction + paid toggle

**Files:**
- Modify: `src/app/api/invoices/route.ts` (accept `direction`, `customer`)
- Create: `src/app/api/invoices/[id]/paid/route.ts`
- Test: extend/`add` under `tests/api/` following the existing api-test pattern

**Interfaces:**
- `POST /api/invoices` accepts `{ direction?, supplier?, customer?, invoiceDate, notes? }` → `{ id }`.
- `POST /api/invoices/[id]/paid` accepts `{ paid: boolean, paidOn?: string }` → `{ ok: true }`, calls `setInvoicePaid`.
- Existing line/post/unpost routes accept `unitPriceCents` where they accept line fields (mirror Task 4's params).

- [ ] **Step 1:** Read `src/app/api/invoices/route.ts` and an existing test in `tests/api/` to copy the harness (auth/db setup). Write a failing test: POST a sale invoice, POST its `/paid`, assert `getInvoice` reflects it.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Implement: thread `direction`/`customer` through the create route; add the `paid` route calling `setInvoicePaid`; thread `unitPriceCents` through the line routes.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(api): sale-invoice create + paid toggle`.

---

## Phase 4 — UI

> UI tasks have no unit harness in this repo (tests cover lib + api). Each ends with an explicit **manual verification** via `npm run dev` and a stated expected observation. Keep desktop layout intact; apply existing mobile-first patterns.

### Task 8: Invoices list — tabs, paid badges, totals

**Files:**
- Modify: `src/app/invoices/page.tsx`
- Modify: `src/components/NewInvoiceButton.tsx` (offer New sale / New purchase)

- [ ] **Step 1:** In `page.tsx`, split `listInvoices` results by `direction`. Add filter tabs (All / Purchases / Sales) via a client wrapper or `searchParams` (`?kind=sale|purchase`). Add a **Kind** column (↗ Sale / ↘ Purchase), a **Party** column (`customer ?? supplier ?? "—"`), and a **Paid** `Badge` (`emerald` "Paid" / `red` "Unpaid") shown only for sales (and optionally purchases). Show two footer totals: `Owed to you` = Σ unpaid posted sales totals; `You owe` = Σ unpaid posted purchase totals.
- [ ] **Step 2:** Update `NewInvoiceButton` to create with `direction`. Provide two actions: "+ New sales invoice" (posts `{ direction: "sale", invoiceDate: today() }`) and "+ New purchase" (existing behavior). Navigate to `/invoices/[id]`.
- [ ] **Step 3: Manual verification.** Run `npm run dev`, open `/invoices`. Expected: tabs filter the list; a new sales invoice appears with an "↗ Sale" kind and an "Unpaid" badge; footer shows the two running totals.
- [ ] **Step 4:** Commit `feat(invoices): list tabs, kind + paid columns, AR/AP totals`.

### Task 9: Sale invoice editor + document + paid toggle

**Files:**
- Modify: `src/components/InvoiceEditor.tsx` (direction-aware: price field for sales, customer field, "N packs × M" qty helper)
- Modify: `src/components/InvoiceDocument.tsx` (sale variant: "Invoice" title, From=business / To=customer, "Unit price" column, optional Paid stamp)
- Modify: `src/components/InvoiceActions.tsx` (add a **Mark paid / Mark unpaid** action for posted sales, calling `/api/invoices/[id]/paid`)
- Modify: `src/app/invoices/[id]/page.tsx` + `src/app/invoices/[id]/print/page.tsx` (pass direction through; subtitle copy)

- [ ] **Step 1:** Make `InvoiceEditor` branch on `invoice.direction`. For a sale: show a **Customer** input (persists via `updateInvoice`), and per line an item picker (must map to an existing item — no free-text create), an integer **Qty (pcs)** with an optional inline "packs × per-pack" helper that computes pcs, and a **Unit price** money input (writes `unitPriceCents`). Reject negative qty/price client-side (`min={0}`). Keep the purchase variant unchanged (unit cost).
- [ ] **Step 2:** Make `InvoiceDocument` direction-aware: for a sale, title "Invoice", `From (you)` = businessName, `To (customer)` = `invoice.customer`, column header "Unit price", line/total off `unitPriceCents`, and a green "PAID" marker when `invoice.paid`.
- [ ] **Step 3:** Add the Mark-paid toggle to `InvoiceActions` (visible only for posted sales). On click, POST to `/api/invoices/[id]/paid` then `router.refresh()`.
- [ ] **Step 4: Manual verification.** `npm run dev`: create a sales invoice, add a line (24 pcs @ $3.00), Post (stock on that item drops by 24 — check `/inventory`), Mark paid; open `/invoices/[id]/print` and confirm a clean "Invoice → customer" document with the Unit price column and PAID marker.
- [ ] **Step 5:** Commit `feat(invoices): sale editor, document, mark-paid`.

### Task 10: Report — top-total blend + Wholesale card

**Files:**
- Modify: `src/app/report/page.tsx`

- [ ] **Step 1:** Use the new `rep.wholesale`. Under the existing per-show cards, render a **Wholesale** `Card` titled with `Net: <Money cents={rep.wholesale.paidProfitCents} />`, listing each `rep.wholesale.invoices` row (number, customer, qty, revenue, cogs, profit). Grey unpaid rows with an "— unpaid —" profit cell. Add a footer: `Owed to you (unpaid): <Money cents={rep.wholesale.owedToYouCents} />`.
- [ ] **Step 2:** The top `Stat` strip already reads `rep.totals.*`, which now includes paid wholesale (Task 6) — add a tiny sub-note under Revenue: `Whatnot <Money> · Wholesale <Money cents={rep.wholesale.paidRevenueCents} />`.
- [ ] **Step 3: Manual verification.** `npm run dev`, open `/report`: a paid sales invoice shows in the Wholesale card and bumps the top Revenue/Net/Your-share; an unpaid one shows greyed and only in "Owed to you".
- [ ] **Step 4:** Commit `feat(report): wholesale card + revenue sub-note`.

### Task 11: Dashboard — include wholesale

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1:** Read `src/app/page.tsx` to see which figures it shows. The dashboard headline numbers derive from `buildLedgerReport` totals (already wholesale-inclusive after Task 6). If it computes revenue/profit independently of `buildLedgerReport`, switch it to read `rep.totals` so wholesale is included; otherwise it's automatic — verify only.
- [ ] **Step 2: Manual verification.** `npm run dev`, open `/`: headline profit/revenue reflect a paid wholesale sale.
- [ ] **Step 3:** Commit `feat(dashboard): include wholesale in headline numbers` (or `chore: verify dashboard wholesale-inclusive`).

### Task 12: Inventory — transparent remaining + adjustments log

**Files:**
- Modify: `src/app/inventory/[id]/page.tsx` (remaining breakdown + adjustments log)
- Modify: `src/components/EditItemModal.tsx` (replace the single "samples/remaining" controls with an adjustments-log editor)
- Create: `src/components/AdjustmentsLog.tsx` (client: list + add/delete via a new `/api/inventory/[id]/adjustments` route)
- Create: `src/app/api/inventory/[id]/adjustments/route.ts` (GET/POST/DELETE → `listAdjustments`/`addAdjustment`/`deleteAdjustment`)

- [ ] **Step 1:** Build the remaining breakdown on the item detail page: a small table `Purchased / − Sold (Whatnot N · wholesale N · brother N) / + Adjustments (Σ) / = Remaining`, using `qtySoldFromLedger`, `qtySoldWholesale`, `qtyGivenToBrother`, `sumAdjustments`, `qtyPurchased`. (Add a `qtySoldByItem`-based legacy line only if non-zero.)
- [ ] **Step 2:** Create the adjustments API route (GET list, POST `{ adjustedOn, reason, qty, note }`, DELETE `?adjId=`), mirroring the existing inventory route's auth/db pattern.
- [ ] **Step 3:** Create `AdjustmentsLog.tsx`: a dated table with reason dropdown (`Sample / Damage-loss / Recount / Other`), a signed qty input (the only place ± is allowed), optional note, add + delete. Refresh on change.
- [ ] **Step 4:** In `EditItemModal`, remove the samples field / `updateItemSamples` call and the direct "remaining" number input; replace with the `AdjustmentsLog` (a recount entry is how you correct remaining now).
- [ ] **Step 5: Manual verification.** `npm run dev`, open an item: the breakdown sums to Remaining; adding a "Damage/Loss −4" drops Remaining by 4 and appears in the log; deleting it restores it.
- [ ] **Step 6:** Commit `feat(inventory): transparent remaining + adjustments log UI`.

### Task 13: No-negative inputs + loud unmapped-alias banner

**Files:**
- Modify: `src/components/InventoryTable.tsx` + `src/app/inventory/page.tsx` (unmapped banner)
- Modify: `src/components/AddProductModal.tsx`, `src/components/InvoiceEditor.tsx` (min=0 on qty/price/cost)

- [ ] **Step 1:** Add `min={0}` and client validation to all quantity/cost/price number inputs (purchase qty/cost, sale qty/price, add-product qty/cost). Adjustment qty stays signed (Task 12) — leave it.
- [ ] **Step 2:** On `/inventory`, compute unmapped names (reuse the report's `unmappedNames`, or `seenProductNames` minus mapped) and render an amber banner when > 0: "N Whatnot product names aren't mapped — their sales count at $0 profit" with a "Map them now →" link to the existing mapping UI/`InventoryForms`.
- [ ] **Step 3: Manual verification.** `npm run dev`: negative inputs are rejected; with an unmapped imported name present, the amber banner shows on `/inventory`.
- [ ] **Step 4:** Commit `feat(inventory): no-negative inputs + unmapped-alias banner`.

---

## Final verification

- [ ] Run the full suite: `npx vitest run` → all green.
- [ ] `npm run build` (or the project's typecheck/lint) → no type errors.
- [ ] Manual smoke: create a sales invoice → post (stock drops, oversell blocked) → mark paid (profit appears on Report + Dashboard) → print document; verify an item's remaining breakdown and adjustments log; verify the unmapped banner.
- [ ] Use `superpowers:finishing-a-development-branch` to decide merge/PR.
