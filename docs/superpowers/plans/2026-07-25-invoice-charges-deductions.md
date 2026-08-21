# Invoice Charges & Deductions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-inventory **charge/deduction** lines to invoices — a free-text name plus a signed amount (positive = a charge like shipping/tax; negative = a deduction/discount) that adjusts the invoice total but never posts to inventory.

**Architecture:** Add a `kind` column to `invoice_lines` (`'item'` default, or `'charge'`). A charge line stores its name in `product_name`, `quantity = 1`, `item_id = NULL`, and the signed amount in **both** `unit_cost_cents` and `unit_price_cents` — so the existing total formula (`SUM(quantity × price-or-cost by direction)`) already includes it and negatives subtract, with no total-math change. Posting and the wholesale sale report **skip** charge lines, so stock, COGS, inventory spend, and goods-profit stay about goods only (the user's "invoice total only" choice). Applies to both purchase and sale invoices.

**Tech Stack:** Next.js (App Router), TypeScript, better-sqlite3, Vitest (node env — no React Testing Library).

## Global Constraints

- **Flat amounts only** (no percentage). A charge line has `quantity = 1` and a signed `amount_cents`; percentage/tax-off-subtotal is out of scope.
- **Charge lines never post to inventory:** no purchase batch, no stock check, no item resolution, no supplier identifier. Only `kind='item'` lines post.
- **Excluded from money reports** (invoice-total-only): the wholesale sale report's qty/revenue/COGS and inventory-spend must not include charge lines. They affect only the invoice's own displayed/paid total.
- A charge line stores the signed amount in **both** `unit_cost_cents` and `unit_price_cents` (so the direction-based total formula picks it up on purchase and sale alike), `quantity = 1`, `item_id = NULL`, `kind = 'charge'`. Amounts may be negative — validation must allow it for charges (existing item-line validation still requires `>= 0`).
- Both **purchase and sale** invoices support charge lines.
- Migration: `ALTER TABLE invoice_lines ADD COLUMN kind TEXT NOT NULL DEFAULT 'item'` (guarded by a `PRAGMA table_info` check; a constant DEFAULT is allowed on ADD COLUMN). Existing lines become `'item'`. The `CHECK` lives in `SCHEMA` for fresh DBs (migrated DBs rely on app-level control, consistent with how `direction` etc. were added).
- Test env is node; NO React Testing Library. UI (Task 4) is verified by `npm run build` + controller live smoke.

---

### Task 1: Schema + migration + `addInvoiceCharge` + `kind` on lines

**Files:**
- Modify: `src/lib/db/schema.ts` (add `kind` to `invoice_lines`)
- Modify: `src/lib/db/connection.ts` (migration)
- Modify: `src/lib/db/invoices.ts` (`InvoiceLine` type + `kind` in `listInvoiceLines`; add `addInvoiceCharge`)
- Test: `tests/lib/db/invoice-charges.test.ts` (create)

**Interfaces:**
- Produces: `InvoiceLine` gains `kind: "item" | "charge"`. New:
  ```typescript
  /** Add a non-inventory charge/deduction line. amountCents may be negative
   *  (a deduction). quantity is 1; item_id is null; kind is 'charge'. */
  export function addInvoiceCharge(db: DB, p: { invoiceId: number; name: string; amountCents: number }): number;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/invoice-charges.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { createInvoice, addInvoiceLine, addInvoiceCharge, listInvoiceLines, getInvoice } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("invoice charges/deductions", () => {
  it("a positive charge adds to the total; a negative deduction subtracts", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: item, productName: "Widget", quantity: 2, unitCostCents: 500 }); // 1000
    addInvoiceCharge(db, { invoiceId: inv, name: "Shipping", amountCents: 1200 });   // +1200
    addInvoiceCharge(db, { invoiceId: inv, name: "Discount", amountCents: -300 });    // -300
    expect(getInvoice(db, inv)!.total).toBe(1000 + 1200 - 300);
  });

  it("marks charge lines with kind='charge' and item lines with kind='item'", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const inv = createInvoice(db, { direction: "sale", customer: "Bob", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: item, productName: "Widget", quantity: 1, unitCostCents: 0, unitPriceCents: 900 });
    addInvoiceCharge(db, { invoiceId: inv, name: "Sales Tax", amountCents: 74 });
    const lines = listInvoiceLines(db, inv);
    expect(lines.find((l) => l.kind === "charge")).toMatchObject({ productName: "Sales Tax", quantity: 1, itemId: null });
    expect(lines.filter((l) => l.kind === "item")).toHaveLength(1);
    expect(getInvoice(db, inv)!.total).toBe(900 + 74);   // sale uses unit_price; charge counts too
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- invoice-charges`
Expected: FAIL (`addInvoiceCharge` missing / no `kind`).

- [ ] **Step 3: Implement**

In `src/lib/db/schema.ts`, add `kind` to the `invoice_lines` table (after `item_id`):
```sql
  kind TEXT NOT NULL DEFAULT 'item' CHECK (kind IN ('item','charge')),
```

In `src/lib/db/connection.ts`, add to `migrate(db)` (guarded, near the other `invoice_lines` column adds):
```typescript
  const lcols2 = (db.prepare("PRAGMA table_info(invoice_lines)").all() as { name: string }[]).map((c) => c.name);
  if (!lcols2.includes("kind")) db.exec("ALTER TABLE invoice_lines ADD COLUMN kind TEXT NOT NULL DEFAULT 'item'");
```
(If a `lcols` variable already exists in that scope for `invoice_lines`, reuse it instead of re-declaring.)

In `src/lib/db/invoices.ts`: add `kind: "item" | "charge";` to `InvoiceLine`; add `il.kind` to the `listInvoiceLines` SELECT; and add:
```typescript
export function addInvoiceCharge(db: DB, p: { invoiceId: number; name: string; amountCents: number }): number {
  const amt = Math.trunc(p.amountCents);
  const info = db.prepare(
    `INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents, unit_price_cents, kind)
     VALUES (?, NULL, ?, 1, ?, ?, 'charge')`
  ).run(p.invoiceId, p.name.trim(), amt, amt);
  return Number(info.lastInsertRowid);
}
```
The invoice `total` formula (in the `SELECT`/`hydrate` for invoices) is unchanged — a charge line has `quantity=1` and its signed amount in both cost/price columns, so it's already included for both directions.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- invoice-charges`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS (additive column; `listInvoiceLines` gains a field).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/invoices.ts tests/lib/db/invoice-charges.test.ts
git commit -m "feat(invoices): kind column + addInvoiceCharge (charge/deduction lines)"
```

---

### Task 2: Charge lines skip posting, preview, and money reports [MONEY-CRITICAL]

**Files:**
- Modify: `src/lib/db/invoices.ts` (`postInvoice` purchase + sale paths; `previewPurchasePost`)
- Modify: `src/lib/calc/ledger-report.ts` (wholesale sale rollup)
- Test: `tests/lib/db/invoice-charges-posting.test.ts` (create)

**Interfaces:**
- Consumes: `kind` on lines (Task 1).
- Produces: posting and reporting behavior that ignores `kind='charge'` lines entirely.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/invoice-charges-posting.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, qtyRemaining } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { createInvoice, addInvoiceLine, addInvoiceCharge, postInvoice, previewPurchasePost, getInvoice } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("charge lines are ignored by posting and preview", () => {
  it("posting a purchase invoice adds stock for item lines but not charge lines", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: item, productName: "Widget", quantity: 5, unitCostCents: 400 });
    addInvoiceCharge(db, { invoiceId: inv, name: "Freight", amountCents: 900 });
    postInvoice(db, inv);
    expect(getInvoice(db, inv)!.status).toBe("posted");
    expect(qtyRemaining(db, item)).toBe(5);   // charge line added no stock
  });

  it("previewPurchasePost never lists a charge line as needing an item", () => {
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceCharge(db, { invoiceId: inv, name: "Freight", amountCents: 900 });
    expect(previewPurchasePost(db, inv)).toEqual({ autoResolved: [], needsReview: [] });
  });

  it("posting a sale invoice with a charge does not require the charge to have an item", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: item, purchasedOn: "2026-07-01", quantity: 10, unitCostCents: 100 });
    const inv = createInvoice(db, { direction: "sale", customer: "Bob", invoiceDate: "2026-07-02", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: item, productName: "Widget", quantity: 3, unitCostCents: 0, unitPriceCents: 500 });
    addInvoiceCharge(db, { invoiceId: inv, name: "Shipping", amountCents: 700 });
    postInvoice(db, inv);   // must NOT throw "must map to an item"
    expect(qtyRemaining(db, item)).toBe(7);   // only the item line reduced stock
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- invoice-charges-posting`
Expected: FAIL — the sale-path test throws `must map to an item` (the charge line has no item), and/or the purchase path tries to batch the charge line.

- [ ] **Step 3: Implement**

In `src/lib/db/invoices.ts`:

- In `postInvoice`, **sale path** validation loop — skip charge lines before the `itemId == null` check and the `qtyByItem` aggregation:
  ```typescript
      for (const line of lines) {
        if (line.kind === "charge") continue;
        if (line.itemId == null) throw new Error(`Line "${line.productName}" must map to an item before posting a sale`);
      }
      const qtyByItem = new Map<number, number>();
      for (const line of lines) {
        if (line.kind === "charge") continue;
        qtyByItem.set(line.itemId!, (qtyByItem.get(line.itemId!) ?? 0) + line.quantity);
      }
  ```
- In `postInvoice`, **purchase path** loop — skip charge lines (no resolution, no batch, no identifier):
  ```typescript
    for (const line of lines) {
      if (line.kind === "charge") continue;
      // ...existing unlinked-line resolution + recordSupplierIdentifier + addPurchase...
    }
  ```
- In `previewPurchasePost`, skip charge lines:
  ```typescript
    for (const line of lines) {
      if (line.kind === "charge") continue;
      if (line.itemId != null) continue;
      // ...existing resolve/bestMatch...
    }
  ```

In `src/lib/calc/ledger-report.ts`, the wholesale rollup query must exclude charge lines so they don't inflate qty/revenue:
```typescript
    const lines = db.prepare("SELECT item_id AS itemId, quantity, unit_price_cents AS price FROM invoice_lines WHERE invoice_id = ? AND kind = 'item'").all(inv.id) as { itemId: number; quantity: number; price: number }[];
```

(`qtySoldWholesale` in `inventory.ts` already filters by `il.item_id = ?`, and charge lines have `item_id IS NULL`, so they're excluded there without change — but add `AND il.kind = 'item'` if you want it explicit.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- invoice-charges-posting`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS. If a wholesale-report test's expected totals change because charges are now excluded, confirm the new numbers are correct (goods-only) and update the expectation, noting it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/invoices.ts src/lib/calc/ledger-report.ts tests/lib/db/invoice-charges-posting.test.ts
git commit -m "feat(invoices): charge lines skip posting, preview, and wholesale report"
```

---

### Task 3: API — add a charge line

**Files:**
- Modify: `src/app/api/invoices/[id]/lines/route.ts` (accept a charge line)
- Test: `tests/api/invoice-charge-api.test.ts` (create)

**Interfaces:**
- Consumes: `addInvoiceCharge` (Task 1).
- Produces: `POST /api/invoices/[id]/lines` with `{ kind: "charge", name, amountCents }` adds a charge line (amount may be negative). The existing item-line POST (`{ productName, quantity, unitCostCents, ... }`) and `DELETE` are unchanged; `DELETE` already removes any line by id.

- [ ] **Step 1: Write the failing test**

Create `tests/api/invoice-charge-api.test.ts` (data-layer style, matching `tests/api/*`):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createInvoice, addInvoiceCharge, listInvoiceLines, deleteInvoiceLine, getInvoice } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("charge line add/remove (data layer)", () => {
  it("adds a negative deduction and it can be deleted", () => {
    const inv = createInvoice(db, { direction: "sale", customer: "Bob", invoiceDate: "2026-07-01", notes: null });
    const id = addInvoiceCharge(db, { invoiceId: inv, name: "Loyalty Credit", amountCents: -250 });
    expect(getInvoice(db, inv)!.total).toBe(-250);
    deleteInvoiceLine(db, id);
    expect(listInvoiceLines(db, inv)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails/passes**

Run: `npm test -- invoice-charge-api`
Expected: PASS once Task 1 is in (asserts the data layer the route wraps). Still add the route branch below and keep this as a guard.

- [ ] **Step 3: Implement the route branch**

In `src/app/api/invoices/[id]/lines/route.ts`, at the top of `POST`, handle the charge kind before the existing item-line validation:
```typescript
  if (b.kind === "charge") {
    if (typeof b.name !== "string" || !b.name.trim() || !Number.isFinite(Number(b.amountCents)))
      return NextResponse.json({ error: "Invalid charge" }, { status: 400 });
    try {
      const id = addInvoiceCharge(await dbForRequest(), { invoiceId, name: b.name.trim(), amountCents: Math.trunc(Number(b.amountCents)) });
      return NextResponse.json({ id });
    } catch { return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 }); }
  }
```
Import `addInvoiceCharge`. (Note: charges are allowed to be negative — do NOT run them through the `costOk >= 0` item validation.)

- [ ] **Step 4: Run the test + build**

Run: `npm test -- invoice-charge-api` then `npm run build`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/invoices/[id]/lines/route.ts tests/api/invoice-charge-api.test.ts
git commit -m "feat(api): add charge/deduction line via invoice lines route"
```

---

### Task 4: UI — add charges in the editor; render on document + PDF

**Files:**
- Modify: `src/components/InvoiceEditor.tsx` (add-charge form + display charge rows)
- Modify: `src/components/InvoiceDocument.tsx` (render charge rows: name + amount, blank qty/unit)
- Modify: `src/lib/pdf/invoice-model.ts` (charge rows: blank qty/unit, amount in line total)
- Test: none new (display-only; verified by build + smoke per Global Constraints)

**Interfaces:**
- Consumes: `POST /api/invoices/[id]/lines` `{kind:"charge", name, amountCents}`; `InvoiceLine.kind` (Task 1).

- [ ] **Step 1: Editor — add-charge form + row display**

In `src/components/InvoiceEditor.tsx`:
- Add a small form (below the existing add-line form): a **Name** text input and an **Amount ($)** number input (allow negatives — `step="0.01"`, no `min`), and an "Add charge / deduction" button. On submit, POST to `/api/invoices/${invoice.id}/lines` with `{ kind: "charge", name, amountCents: Math.round(amount * 100) }`, then append the returned line to local state with `kind: "charge"`, `quantity: 1`, `itemId: null`, `productName: name`, `unitCostCents`/`unitPriceCents` = the cents, `displayName: name`. (Mirror how the existing add-line handler updates `lines` state, including the `displayName` field added in the live-name feature.)
- In the existing line-rows table, for a `l.kind === "charge"` row, render the name and the amount in the line-total cell and leave qty/unit blank (e.g. `l.kind === "charge" ? "—" : l.quantity`). Keep the delete control working (it already deletes by line id).

- [ ] **Step 2: Document — render charge rows**

In `src/components/InvoiceDocument.tsx`, in the `lines.map`, branch on `l.kind`:
- For `kind === "charge"`: render `<td>{l.displayName}</td>`, blank Qty and Unit cells (`<td></td>`), and the amount in the Line-total cell: `<Money cents={isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents} />`.
- For `kind === "item"`: the existing rendering (qty, unit, qty×unit).
The `total` reducer already includes charge lines (quantity 1 × amount); leave it, or make it robust by using the same per-row amount for charges.

- [ ] **Step 3: PDF model — charge rows**

In `src/lib/pdf/invoice-model.ts`, when mapping a `kind === "charge"` line, set the row so qty/unit are blank and the amount is the signed charge (e.g. `qty: null` or `1`, `description: l.displayName`, `amountCents = unit_price/cost as appropriate`). Match whatever the model/renderer expects; ensure the amount column shows the signed charge and the invoice total still sums correctly.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds, no type errors.

- [ ] **Step 5: Manual smoke on the dev copy**

On the dev server: open a draft invoice → add a **Shipping** charge (+$12) and a **Discount** deduction (−$5) → the line table shows both and the Total reflects +12 −5. View the invoice document and the PDF → both show the charge/deduction rows and the adjusted total. Post the invoice → it posts, and stock reflects only the item lines (charges added no stock). Delete a charge → total updates.

- [ ] **Step 6: Commit**

```bash
git add src/components/InvoiceEditor.tsx src/components/InvoiceDocument.tsx src/lib/pdf/invoice-model.ts
git commit -m "feat(invoices): add/display charge & deduction lines in editor, document, PDF"
```

---

### Task 5: Full-suite green + build + end-to-end smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite** — Run: `npm test` — Expected: PASS (prior count + the new charge tests).
- [ ] **Step 2: Build** — Run: `npm run build` — Expected: succeeds.
- [ ] **Step 3: End-to-end smoke** — On the dev copy: on a **purchase** invoice add a shipping charge and a negative deduction, confirm the total; post it and confirm stock only reflects item lines and the wholesale/spend numbers are unchanged by the charges. Repeat on a **sale** invoice (charge doesn't require an item; posting still drops stock only for item lines; the customer PDF shows the charge and adjusted total). Confirm no dev-server console errors.
- [ ] **Step 4: Final commit (only if fixups were needed)**

```bash
git add -A && git commit -m "chore: finalize invoice charges & deductions"
```

---

## Self-Review

**Spec coverage:**
- Non-inventory charge lines (shipping/tax/fee, user-named) → `kind='charge'` + `addInvoiceCharge` (Task 1), skipped by posting (Task 2). ✓
- Deductions (negative amounts subtract from total) → signed `amount_cents`, allowed negative in the route (Task 3); total formula subtracts. ✓
- Flat amounts, both invoice types → design; sale + purchase tests (Task 2). ✓
- Invoice-total-only (excluded from COGS/spend/goods-profit) → posting skip + wholesale-report `kind='item'` filter (Task 2); spend via batches is naturally excluded. ✓

**Placeholder scan:** none. Task 4 gives per-surface rendering rules; the PDF row mapping (Step 3) is a reconcile-to-model step with the intended shape stated. Task 4 has no automated test by the node-env/no-RTL constraint.

**Type consistency:** `InvoiceLine.kind: "item" | "charge"` (Task 1) is read by posting/preview/report (Task 2) and the render surfaces (Task 4). `addInvoiceCharge(db, {invoiceId, name, amountCents})` is called by the route (Task 3). The charge line's amount lives in `unit_cost_cents` and `unit_price_cents` (both), so the existing `total` formula and the document/PDF per-row amount pick it up for either direction.

---

## Port note (after completion)

Append "Feature 7 — Invoice charges & deductions" to `docs/PORT-TO-WHATNOT-MANAGER.md`: add a `kind` column (`item`/`charge`) to invoice lines; a charge line = name + signed amount in both cost/price columns, quantity 1, item_id null; the total formula already includes it. GOTCHAS: charge lines must be skipped in `postInvoice` (both paths), `previewPurchasePost`, and the wholesale sale report's line query (`AND kind='item'`) or they inflate units/revenue; allow negative amounts in the API (don't run charges through the `>= 0` item validation); render charge rows with blank qty/unit on the document + PDF.
