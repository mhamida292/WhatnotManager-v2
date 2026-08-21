# Invoice PDF — Total Pieces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a **Total pieces** count on the invoice PDF — the total number of units across the invoice's inventory (item) lines, excluding non-inventory charge/deduction lines.

**Architecture:** Add `totalPieces: number` to `InvoicePdfModel`, computed in `invoicePdfModel` as the sum of `quantity` over `kind === 'item'` lines (charges are not pieces — consistent with the on-screen document's units count). Render it on the `InvoicePdf` react-pdf document near the total.

**Tech Stack:** Next.js, TypeScript, @react-pdf/renderer, Vitest.

## Global Constraints

- **Total pieces = Σ `quantity` for `kind === 'item'` lines only.** Charge lines (`kind==='charge'`) are excluded (they carry `quantity: 1` but are not pieces) — matches how the on-screen invoice document counts units.
- Compute from the **raw** `InvoiceLine[]` passed to `invoicePdfModel` (which carry `kind`), NOT from the mapped `modelLines` (which set charge qty to 1).
- The PDF render test (`tests/lib/pdf/render.test.tsx`) constructs `InvoicePdfModel` literals — they must be updated to include `totalPieces` so the suite compiles.

---

### Task 1: `invoicePdfModel` computes `totalPieces`

**Files:**
- Modify: `src/lib/pdf/invoice-model.ts` (`InvoicePdfModel` type + computation)
- Modify: `tests/lib/pdf/render.test.tsx` (add `totalPieces` to the model literal(s) so it compiles)
- Test: `tests/lib/pdf/invoice-model.test.ts` (create)

**Interfaces:**
- Produces: `InvoicePdfModel` gains `totalPieces: number` = Σ `quantity` over `kind==='item'` lines.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/pdf/invoice-model.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { invoicePdfModel } from "@/lib/pdf/invoice-model";
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";
import type { Settings } from "@/lib/db/settings";

const settings = {
  invoiceShowPhone: 0, invoiceShowAddress: 0, invoiceShowEmail: 0,
  invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
} as unknown as Settings;

function line(p: Partial<InvoiceLine>): InvoiceLine {
  return { id: 1, invoiceId: 1, itemId: null, productName: "x", displayName: "x",
    quantity: 1, unitCostCents: 0, unitPriceCents: 0, kind: "item", ...p } as InvoiceLine;
}
const invoice = { direction: "sale", number: "INV-1", customer: "C", supplier: null, invoiceDate: "2026-07-01" } as unknown as Invoice;

describe("invoicePdfModel totalPieces", () => {
  it("sums quantities of item lines and excludes charge lines", () => {
    const lines = [
      line({ quantity: 6, kind: "item" }),
      line({ quantity: 4, kind: "item" }),
      line({ quantity: 1, kind: "charge", productName: "Shipping", displayName: "Shipping" }),
    ];
    const m = invoicePdfModel(invoice, lines, settings);
    expect(m.totalPieces).toBe(10);   // 6 + 4, charge excluded
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- invoice-model`
Expected: FAIL (`totalPieces` undefined / not on type).

- [ ] **Step 3: Implement**

In `src/lib/pdf/invoice-model.ts`: add `totalPieces: number;` to the `InvoicePdfModel` interface, and compute it in the returned object:
```typescript
    totalPieces: lines.reduce((s, l) => s + (l.kind === "charge" ? 0 : l.quantity), 0),
```
(Add it alongside `totalCents` in the returned object.)

- [ ] **Step 4: Fix the render test literal**

In `tests/lib/pdf/render.test.tsx`, add `totalPieces: <n>` to each `InvoicePdfModel` literal so it type-checks (e.g. the top-level `model` gets `totalPieces: 10` to match its 6+4 lines; any other literal in that file gets a matching count).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- invoice-model` then `npm test -- pdf/render`
Expected: PASS.

- [ ] **Step 6: Full suite + commit**

Run: `npm test` (expected PASS), then:
```bash
git add src/lib/pdf/invoice-model.ts tests/lib/pdf/invoice-model.test.ts tests/lib/pdf/render.test.tsx
git commit -m "feat(pdf): invoicePdfModel computes totalPieces (item lines only)"
```

---

### Task 2: Render "Total pieces" on the invoice PDF

**Files:**
- Modify: `src/components/pdf/InvoicePdf.tsx`
- Test: none new (render smoke covered by `tests/lib/pdf/render.test.tsx`; verified by build + controller live smoke)

**Interfaces:**
- Consumes: `model.totalPieces` (Task 1).

- [ ] **Step 1: Render it near the total**

In `src/components/pdf/InvoicePdf.tsx`, add a "Total pieces" line just above the `totalRow` (so it sits with the totals). Add a style and the view:

```tsx
  // in StyleSheet.create({...}):
  piecesRow: { flexDirection: "row", marginTop: 4 },
  piecesText: { width: "80%", textAlign: "right", padding: "2 4", fontSize: 8, color: "#333" },
```

```tsx
          {/* directly before <View style={s.totalRow} ...> */}
          <View style={s.piecesRow} wrap={false}>
            <Text style={s.piecesText}>Total pieces: {model.totalPieces}</Text>
          </View>
          <View style={s.totalRow} wrap={false}>
            <Text style={s.totalLabel}>TOTAL</Text>
            <Text style={s.totalVal}>{money(model.totalCents)}</Text>
          </View>
```

(Placement/styling can be adjusted to match the document's look; the requirement is that the total piece count is clearly shown on the PDF.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke on the dev copy**

Download an invoice PDF that has multiple item lines (and ideally a charge line) → the PDF shows "Total pieces: N" where N is the sum of item-line quantities, and the charge line does NOT add to N. Confirm the amount total is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/pdf/InvoicePdf.tsx
git commit -m "feat(pdf): show Total pieces on the invoice PDF"
```

---

### Task 3: Full-suite green + build + smoke

- [ ] **Step 1:** `npm test` — Expected: PASS.
- [ ] **Step 2:** `npm run build` — Expected: succeeds.
- [ ] **Step 3:** Download a real invoice PDF on the dev copy; confirm "Total pieces" reads the item-line unit sum (charges excluded) and the money total is unaffected. Confirm no dev-server errors.
- [ ] **Step 4:** Final commit only if fixups were needed.

---

## Self-Review

**Spec coverage:** Total pieces on the invoice PDF → Task 1 (model) + Task 2 (render). Excludes charges → `kind==='item'` sum (Task 1), unit-tested. ✓

**Placeholder scan:** none. Task 2 styling is adjustable but the render is concrete.

**Type consistency:** `InvoicePdfModel.totalPieces: number` (Task 1) is read by `InvoicePdf` (Task 2) and set in every model literal (the model builder + the render-test literals).

---

## Port note (after completion)

Append "Feature 8 — Total pieces on the invoice PDF" to `docs/PORT-TO-WHATNOT-MANAGER.md`: add `totalPieces` (Σ quantity over `kind='item'` lines — exclude charges) to the PDF view-model and render it near the total on the PDF document. Gotcha: compute from the raw lines' `kind`, not the mapped rows (charges carry qty 1); update any typed PDF-model test literals.
