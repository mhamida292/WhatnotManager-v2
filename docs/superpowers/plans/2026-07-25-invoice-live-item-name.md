# Invoices Show the Live Item Name — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make invoices display each linked line's **current** inventory item name (so renaming an item is reflected across all its invoices, past and future), falling back to the stored snapshot for lines with no linked item.

**Architecture:** Add a computed `displayName` to `listInvoiceLines` via a `LEFT JOIN inventory_items` — `COALESCE(inventory_items.name, invoice_lines.product_name)`. The three display surfaces (the on-screen invoice document, the draft editor's line table, and the PDF model) render `displayName`; the stored `product_name` snapshot and the `productName` field are left unchanged so the posting/preview **logic** (which resolves unlinked lines by their snapshot text) is unaffected. No data migration — `displayName` is computed at read time, so it applies to all existing invoices automatically.

**Tech Stack:** Next.js (App Router), TypeScript, better-sqlite3, Vitest (node env — no React Testing Library).

## Global Constraints

- **Additive, not a replacement.** Keep `invoice_lines.product_name` and the existing `InvoiceLine.productName` field exactly as-is. Add a new `displayName` field. Logic consumers (`postInvoice`, `previewPurchasePost`) must keep using `productName` (the snapshot) — do NOT switch them to `displayName`.
- **Fallback rule:** `displayName = inventory_items.name` when the line's `item_id` links to an existing item; otherwise the stored `product_name`. A line whose `item_id` is NULL (unlinked / non-inventory line) or whose item was deleted (`item_id` set NULL via `ON DELETE SET NULL`) shows the snapshot.
- Only the **display** surfaces change: `src/components/InvoiceDocument.tsx` (also used by the print page), `src/components/InvoiceEditor.tsx` (draft line table), and `src/lib/pdf/invoice-model.ts` (PDF). No other `.productName` usage elsewhere in the app is touched.
- Test env is node (`vitest.config.ts`), NO React Testing Library. The display-component edits are verified by `npm run build` + a controller live smoke; the data behavior is unit-tested via `listInvoiceLines`.

---

### Task 1: `listInvoiceLines` returns a live `displayName`

**Files:**
- Modify: `src/lib/db/invoices.ts` — `InvoiceLine` interface (line ~13) and `listInvoiceLines` (line ~71)
- Test: `tests/lib/db/invoice-line-display-name.test.ts` (create)

**Interfaces:**
- Produces: `InvoiceLine` gains `displayName: string`. `listInvoiceLines` returns it as `COALESCE(inventory_items.name, invoice_lines.product_name)` via `LEFT JOIN inventory_items ON inventory_items.id = invoice_lines.item_id`. `productName` (the raw snapshot) is unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/invoice-line-display-name.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, renameItem } from "@/lib/db/inventory";
import { createInvoice, addInvoiceLine, listInvoiceLines } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("listInvoiceLines displayName", () => {
  it("shows the linked item's CURRENT name, and updates after a rename", () => {
    const id = insertItem(db, { name: "Old Name", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: id, productName: "Old Name", quantity: 2, unitCostCents: 100 });

    expect(listInvoiceLines(db, inv)[0].displayName).toBe("Old Name");

    renameItem(db, id, "New Name");
    const line = listInvoiceLines(db, inv)[0];
    expect(line.displayName).toBe("New Name");   // live join reflects the rename
    expect(line.productName).toBe("Old Name");   // snapshot is unchanged
  });

  it("falls back to the snapshot for an unlinked line (no item_id)", () => {
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: null, productName: "Free Text Line", quantity: 1, unitCostCents: 50 });
    expect(listInvoiceLines(db, inv)[0].displayName).toBe("Free Text Line");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- invoice-line-display-name`
Expected: FAIL (`displayName` undefined).

- [ ] **Step 3: Implement**

In `src/lib/db/invoices.ts`, add `displayName: string;` to the `InvoiceLine` interface, and update `listInvoiceLines`:

```typescript
export function listInvoiceLines(db: DB, invoiceId: number): InvoiceLine[] {
  return db.prepare(
    `SELECT il.id, il.invoice_id AS invoiceId, il.item_id AS itemId,
       il.product_name AS productName,
       COALESCE(ii.name, il.product_name) AS displayName,
       il.quantity, il.unit_cost_cents AS unitCostCents, il.unit_price_cents AS unitPriceCents
     FROM invoice_lines il
     LEFT JOIN inventory_items ii ON ii.id = il.item_id
     WHERE il.invoice_id = ? ORDER BY il.id`
  ).all(invoiceId) as InvoiceLine[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- invoice-line-display-name`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (adding a field is backward-compatible; logic consumers ignore it).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/invoices.ts tests/lib/db/invoice-line-display-name.test.ts
git commit -m "feat(invoices): listInvoiceLines returns live displayName (item name, snapshot fallback)"
```

---

### Task 2: Render `displayName` on the invoice document, editor, and PDF

**Files:**
- Modify: `src/components/InvoiceDocument.tsx` (line ~68)
- Modify: `src/components/InvoiceEditor.tsx` (line ~125)
- Modify: `src/lib/pdf/invoice-model.ts` (line ~22)
- Test: none new (display-only; verified by build + smoke per Global Constraints)

**Interfaces:**
- Consumes: `InvoiceLine.displayName` (Task 1).

- [ ] **Step 1: Update the on-screen invoice document**

In `src/components/InvoiceDocument.tsx`, the line-table cell currently renders `{l.productName}`. Change it to `{l.displayName}`. (This component is also used by `src/app/invoices/[id]/print/page.tsx`, so the print view updates too.)

- [ ] **Step 2: Update the draft editor's line table**

In `src/components/InvoiceEditor.tsx`, the posted/committed line rows render `{l.productName}` (line ~125). Change that display cell to `{l.displayName}`. Leave the add-line form's `form.name` free-text input and the `productName` sent on create unchanged — only the existing-line display cell changes.

- [ ] **Step 3: Update the PDF model**

In `src/lib/pdf/invoice-model.ts`, the line mapping uses `description: l.productName` (line ~22). Change it to `description: l.displayName`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds, no type errors (all three consume `InvoiceLine`, which now has `displayName`).

- [ ] **Step 5: Manual smoke on the dev copy**

On the dev server: open an item, rename it; open one of its posted invoices (on-screen document) → the line shows the **new** item name. Download the invoice PDF → the line description shows the new name. Confirm an invoice line with no linked item (a free-text line, if present) still shows its typed text.

- [ ] **Step 6: Commit**

```bash
git add src/components/InvoiceDocument.tsx src/components/InvoiceEditor.tsx src/lib/pdf/invoice-model.ts
git commit -m "feat(invoices): render live item name on document, editor, and PDF"
```

---

### Task 3: Full-suite green + build + end-to-end smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite** — Run: `npm test` — Expected: PASS (prior count + the 2 new displayName tests).
- [ ] **Step 2: Build** — Run: `npm run build` — Expected: succeeds.
- [ ] **Step 3: End-to-end smoke** — On the dev copy: rename an item that appears on a posted invoice; verify (a) the invoice detail page, (b) the print page, and (c) the downloaded PDF all show the new name; verify a purchase invoice with an unlinked line still shows the snapshot; verify posting still works (posting logic uses the snapshot `productName`, unaffected). Confirm no dev-server console errors.
- [ ] **Step 4: Final commit (only if fixups were needed)**

```bash
git add -A && git commit -m "chore: finalize invoice live item name"
```

---

## Self-Review

**Spec coverage:**
- Invoices show the current linked item name → Tasks 1 + 2 (`displayName` on document, editor, PDF). ✓
- Retroactive with no migration → `displayName` computed at read time in `listInvoiceLines`. ✓
- Fallback to snapshot for unlinked / deleted-item lines → `COALESCE(ii.name, il.product_name)` + `LEFT JOIN` (Task 1), unit-tested. ✓
- Posting/preview logic unaffected → `productName` snapshot unchanged; logic consumers untouched (Global Constraints). ✓

**Placeholder scan:** none. Task 2 references exact line numbers to locate the three display cells; each is a one-token change (`productName` → `displayName`) at a known site. Task 2 has no automated test by the node-env/no-RTL constraint.

**Type consistency:** `InvoiceLine.displayName: string` (Task 1) is the field read in Task 2's three surfaces. `listInvoiceLines`' SELECT aliases every column to the `InvoiceLine` field names; `COALESCE(ii.name, il.product_name)` is never null (both operands present when linked; snapshot otherwise), so `displayName` is always a string.

---

## Port note (after completion)

Append a "Feature 6 — Invoices show live item name" section to `docs/PORT-TO-WHATNOT-MANAGER.md`: add a `displayName` (`COALESCE(item name, snapshot)` via `LEFT JOIN`) to the invoice-line fetch, render it on the invoice document/editor/PDF, keep the `product_name` snapshot for posting logic and unlinked-line fallback. Gotcha: don't switch the posting/preview resolvers to the live name — they must resolve unlinked lines by the stored snapshot text.
