# Unified Item Identifiers — Plan 3: Invoice Supplier-Code Suggest-and-Confirm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When posting a **purchase** invoice, stop silently exact-name-matching-or-creating unlinked lines. Instead, remember each supplier's product name as a `source='supplier'` identifier so future invoices auto-resolve, and for a line that still has no match, present its best-guess item for the user to confirm (or override / create) at Post time — never auto-linking.

**Architecture:** Three data-layer pieces (all TDD): (1) `recordSupplierIdentifier` — a collision-guarded write that remembers a supplier name→item mapping without ever stealing an existing identifier; (2) `previewPurchasePost` — classifies each unlinked purchase line as auto-resolvable (its name already maps to an item) or needs-review (with a `bestMatch` suggestion); (3) `postInvoice` extended to accept explicit line→item **resolutions**, applying them, auto-resolving the rest via the identifier table, recording new supplier identifiers, then creating purchase batches exactly as before. The API exposes a `post-preview` endpoint and threads resolutions through the existing `post` endpoint; the client's Post button previews first and, only when a line needs review, opens a confirm modal before posting.

**Tech Stack:** Next.js (App Router), TypeScript, better-sqlite3, Vitest (node env — no React Testing Library).

## Global Constraints

- **Scope is PURCHASE invoices only.** Sales invoices already require every line to have an item before posting (`postInvoice` sale path) — leave that path unchanged.
- **Always ask:** a `bestMatch` suggestion is only ever *pre-selected* in the UI; a line is linked to an item only via an explicit user confirmation (or an already-existing identifier that auto-resolves). Never auto-link a line to an item purely from a score.
- **Never steal an identifier (the `UNIQUE(code)` hardening deferred from Plan 1's review).** `item_identifiers` has a **global** `UNIQUE(code)`. When recording a supplier identifier for a code that already exists: if it points at the same item, no-op; if it points at a **different** item or a different `source`, DO NOT overwrite — skip persisting (the line still links correctly for this invoice; only the global "remember" is skipped).
- Reuse the existing scorer `src/lib/calc/name-match.ts` (`bestMatch`, `MATCH_THRESHOLD`) and the base-normalizer `baseProductName` from `@/lib/csv/classify`. Identifier `code`s are stored base-normalized (matching how `resolveItemId` looks them up) — see `setAlias` in `src/lib/db/aliases.ts` for the existing pattern.
- `postInvoice` is atomic (wrapped in `db.transaction`). All new work (resolutions, identifier writes, batch creation) stays inside that one transaction. Nested `insertItem` transactions are safe (better-sqlite3 savepoints).
- Test env is node (`vitest.config.ts`), NO React Testing Library. The client modal (Task 5) has NO component unit test — it is verified by `npm run build` + a controller live smoke. Do NOT add a test that renders a React component.
- Existing `postInvoice(db, id)` callers must keep working: the new `resolutions` parameter is **optional**. With no resolutions, a purchase line whose name already resolves via an identifier links to that item; a line that resolves to nothing throws `Line "<name>" needs an item` (the previous silent auto-create is intentionally removed).

---

### Task 1: `recordSupplierIdentifier` — collision-guarded remember

**Files:**
- Modify: `src/lib/db/aliases.ts` (add the function; keep existing exports)
- Test: `tests/lib/db/supplier-identifier.test.ts` (create)

**Interfaces:**
- Consumes: `baseProductName` (already imported in `aliases.ts`).
- Produces:
  ```typescript
  /** Remember a supplier's product name → item as a source='supplier' identifier.
   *  Collision-safe: writes only when the (base-normalized) code is free or already
   *  points at this same item. Returns true if an identifier now maps code→itemId,
   *  false if a different item/source already owns the code (left untouched). */
  export function recordSupplierIdentifier(db: DB, code: string, itemId: number): boolean;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/supplier-identifier.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias, resolveItemId } from "@/lib/db/aliases";
import { recordSupplierIdentifier } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("recordSupplierIdentifier", () => {
  it("writes a supplier identifier that then resolves to the item", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const wrote = recordSupplierIdentifier(db, "ACME-4471", id);
    expect(wrote).toBe(true);
    expect(resolveItemId(db, "ACME-4471")).toBe(id);
    const row = db.prepare("SELECT source FROM item_identifiers WHERE code = 'ACME-4471'").get() as { source: string };
    expect(row.source).toBe("supplier");
  });

  it("is a no-op (returns true) when the code already points at the same item", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    recordSupplierIdentifier(db, "ACME-4471", id);
    const again = recordSupplierIdentifier(db, "ACME-4471", id);
    expect(again).toBe(true);
    const n = db.prepare("SELECT COUNT(*) n FROM item_identifiers WHERE code = 'ACME-4471'").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("does NOT steal a code owned by a different item (returns false, leaves it)", () => {
    const a = insertItem(db, { name: "Item A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "Item B", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Shared Name", a); // a whatnot identifier owns this code, → item a
    const wrote = recordSupplierIdentifier(db, "Shared Name", b);
    expect(wrote).toBe(false);
    expect(resolveItemId(db, "Shared Name")).toBe(a); // unchanged
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- supplier-identifier`
Expected: FAIL ("recordSupplierIdentifier is not a function").

- [ ] **Step 3: Implement**

In `src/lib/db/aliases.ts`, add:

```typescript
export function recordSupplierIdentifier(db: DB, code: string, itemId: number): boolean {
  const base = baseProductName(code);
  const existing = db.prepare("SELECT item_id AS itemId FROM item_identifiers WHERE code = ?").get(base) as { itemId: number } | undefined;
  if (existing) return Number(existing.itemId) === itemId; // same item → ok; different → don't steal
  db.prepare("INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'supplier', ?)").run(itemId, base);
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- supplier-identifier`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/aliases.ts tests/lib/db/supplier-identifier.test.ts
git commit -m "feat(db): recordSupplierIdentifier (collision-guarded supplier remember)"
```

---

### Task 2: `previewPurchasePost` — classify unlinked lines

**Files:**
- Modify: `src/lib/db/invoices.ts` (add the function + its types; keep existing exports)
- Test: `tests/lib/db/preview-purchase-post.test.ts` (create)

**Interfaces:**
- Consumes: `listInvoiceLines` (same module), `resolveItemId` (`@/lib/db/aliases`), `bestMatch`/`MATCH_THRESHOLD` (`@/lib/calc/name-match`), `listItems` (`@/lib/db/inventory`).
- Produces:
  ```typescript
  export interface LineReview {
    lineId: number; productName: string;
    suggestedItemId: number | null; suggestedItemName: string | null;
    score: number; confident: boolean;
  }
  export interface PostPreview {
    autoResolved: { lineId: number; itemId: number }[];
    needsReview: LineReview[];
  }
  /** Purchase-only. Lines already linked to an item are ignored (nothing to decide).
   *  An unlinked line whose name resolves via an identifier is auto-resolved;
   *  otherwise it needs review with a best-match suggestion. */
  export function previewPurchasePost(db: DB, invoiceId: number): PostPreview;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/preview-purchase-post.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { createInvoice, addInvoiceLine, previewPurchasePost } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

// Real signatures (verified in invoices.ts):
//   createInvoice(db, { direction?, supplier?, customer?, invoiceDate, notes }) => number
//     — invoiceDate and notes are REQUIRED (pass null when unused).
//   addInvoiceLine(db, { invoiceId, itemId, productName, quantity, unitCostCents, unitPriceCents? }) => number

describe("previewPurchasePost", () => {
  it("auto-resolves a line whose name already maps to an item", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    setAlias(db, "ACME Booster", id); // identifier exists
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: null, notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "ACME Booster", quantity: 10, unitCostCents: 400 });
    const pre = previewPurchasePost(db, invId);
    expect(pre.autoResolved).toEqual([{ lineId, itemId: id }]);
    expect(pre.needsReview).toEqual([]);
  });

  it("flags an unresolved line with a best-match suggestion", () => {
    const id = insertItem(db, { name: "Pokemon Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: null, notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "Pokemon Booster Box (Case)", quantity: 5, unitCostCents: 400 });
    const pre = previewPurchasePost(db, invId);
    expect(pre.autoResolved).toEqual([]);
    expect(pre.needsReview).toHaveLength(1);
    expect(pre.needsReview[0]).toMatchObject({ lineId, suggestedItemId: id });
    expect(pre.needsReview[0].confident).toBe(true);
  });

  it("ignores lines already linked to an item", () => {
    const id = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: null, notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: id, productName: "Widget", quantity: 1, unitCostCents: 100 });
    const pre = previewPurchasePost(db, invId);
    expect(pre.autoResolved).toEqual([]);
    expect(pre.needsReview).toEqual([]);
  });
});
```

> The `createInvoice`/`addInvoiceLine` signatures above are verified against `src/lib/db/invoices.ts`; use them as written. `previewPurchasePost` is the new export you're adding in this task.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- preview-purchase-post`
Expected: FAIL (function missing).

- [ ] **Step 3: Implement**

In `src/lib/db/invoices.ts`, add the interfaces above and:

```typescript
export function previewPurchasePost(db: DB, invoiceId: number): PostPreview {
  const items = listItems(db).map((i) => ({ id: i.id, name: i.name }));
  const byId = new Map(items.map((i) => [i.id, i.name]));
  const lines = listInvoiceLines(db, invoiceId);
  const autoResolved: { lineId: number; itemId: number }[] = [];
  const needsReview: LineReview[] = [];
  for (const line of lines) {
    if (line.itemId != null) continue; // already linked
    const resolved = resolveItemId(db, line.productName);
    if (resolved != null) {
      autoResolved.push({ lineId: line.id, itemId: resolved });
      continue;
    }
    const m = bestMatch(line.productName, items);
    needsReview.push({
      lineId: line.id,
      productName: line.productName,
      suggestedItemId: m ? m.itemId : null,
      suggestedItemName: m ? byId.get(m.itemId) ?? null : null,
      score: m ? m.score : 0,
      confident: m ? m.score >= MATCH_THRESHOLD : false,
    });
  }
  return { autoResolved, needsReview };
}
```

Add the required imports at the top of `invoices.ts` if not present: `resolveItemId` from `./aliases`, `bestMatch`/`MATCH_THRESHOLD` from `@/lib/calc/name-match`, `listItems` from `./inventory`. (Watch for an import cycle: `inventory.ts` imports from `./purchases` and `./adjustments`, not `./invoices`, so importing `listItems` into `invoices.ts` is safe — verify no cycle at build time.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- preview-purchase-post`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/invoices.ts tests/lib/db/preview-purchase-post.test.ts
git commit -m "feat(db): previewPurchasePost classifies unlinked purchase lines"
```

---

### Task 3: `postInvoice` applies resolutions + records supplier identifiers

**Files:**
- Modify: `src/lib/db/invoices.ts` (`postInvoice` signature + purchase path)
- Test: `tests/lib/db/post-invoice-resolutions.test.ts` (create)

**Interfaces:**
- Consumes: `recordSupplierIdentifier` (Task 1), `resolveItemId` (Task 2 imports), `insertItem`, `addPurchase` (already imported).
- Produces:
  ```typescript
  export type PostResolution =
    | { lineId: number; itemId: number }        // link this line to an existing item
    | { lineId: number; createName: string };   // create a new item with this name, link it
  export function postInvoice(db: DB, id: number, resolutions?: PostResolution[]): void;
  ```
  Purchase path per unlinked line: use a matching resolution if present (link existing item, or create a new item via `insertItem`); else `resolveItemId(productName)`; else throw ``Line "<name>" needs an item``. After determining `itemId`, set the line's `item_id`, call `recordSupplierIdentifier(db, productName, itemId)` (remember for next time; collision-safe), then `addPurchase` as before. Sales path unchanged. Already-linked lines: still `recordSupplierIdentifier` for their `productName` (so a manually-picked line also teaches the mapping).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/post-invoice-resolutions.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, qtyRemaining } from "@/lib/db/inventory";
import { resolveItemId } from "@/lib/db/aliases";
import { createInvoice, addInvoiceLine, postInvoice, previewPurchasePost } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });
// Signatures (verified in invoices.ts):
//   createInvoice(db, { direction?, invoiceDate, notes }) => number
//   addInvoiceLine(db, { invoiceId, itemId, productName, quantity, unitCostCents }) => number

describe("postInvoice with resolutions", () => {
  it("links an unlinked line via a resolution, remembers the supplier name, and adds stock", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "ACME Booster", quantity: 10, unitCostCents: 400 });
    postInvoice(db, invId, [{ lineId, itemId: id }]);
    expect(qtyRemaining(db, id)).toBe(10);               // batch added
    expect(resolveItemId(db, "ACME Booster")).toBe(id);   // remembered as supplier identifier
    // a SECOND invoice with the same supplier name now auto-resolves (no review needed):
    const inv2 = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-02", notes: null });
    addInvoiceLine(db, { invoiceId: inv2, itemId: null, productName: "ACME Booster", quantity: 3, unitCostCents: 400 });
    expect(previewPurchasePost(db, inv2).needsReview).toEqual([]);
  });

  it("creates a new item from a createName resolution", () => {
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "Brand New Thing", quantity: 4, unitCostCents: 250 });
    postInvoice(db, invId, [{ lineId, createName: "Brand New Thing" }]);
    const newId = resolveItemId(db, "Brand New Thing");
    expect(newId).not.toBeNull();
    expect(qtyRemaining(db, newId!)).toBe(4);
  });

  it("throws when an unlinked line has no resolution and no existing identifier", () => {
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "Orphan Line", quantity: 1, unitCostCents: 100 });
    expect(() => postInvoice(db, invId)).toThrow(/needs an item/);
  });

  it("still auto-resolves an unlinked line via an existing identifier with no resolution", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    // first post remembers the supplier name "ACME Booster" as a source='supplier' identifier:
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "ACME Booster", quantity: 2, unitCostCents: 400 });
    postInvoice(db, invId, [{ lineId, itemId: id }]);
    const inv2 = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-02", notes: null });
    addInvoiceLine(db, { invoiceId: inv2, itemId: null, productName: "ACME Booster", quantity: 5, unitCostCents: 400 });
    postInvoice(db, inv2);  // no resolutions needed — auto-resolves via the remembered identifier
    expect(qtyRemaining(db, id)).toBe(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- post-invoice-resolutions`
Expected: FAIL (signature/behavior not present).

- [ ] **Step 3: Implement**

In `src/lib/db/invoices.ts`, change the `postInvoice` signature and replace the purchase path. New signature:

```typescript
export function postInvoice(db: DB, id: number, resolutions: PostResolution[] = []): void {
```

Replace the `// purchase path (unchanged)` block with:

```typescript
    // purchase path: resolve each unlinked line explicitly (no silent auto-create),
    // remember supplier names, then create batches.
    const resByLine = new Map(resolutions.map((r) => [r.lineId, r]));
    for (const line of lines) {
      let itemId = line.itemId;
      if (itemId == null) {
        const r = resByLine.get(line.id);
        if (r && "itemId" in r) {
          itemId = r.itemId;
        } else if (r && "createName" in r) {
          itemId = insertItem(db, { name: r.createName, unitCostCents: line.unitCostCents, qtyPurchased: 0, lotId: null });
        } else {
          const resolved = resolveItemId(db, line.productName);
          if (resolved == null) throw new Error(`Line "${line.productName}" needs an item`);
          itemId = resolved;
        }
        db.prepare("UPDATE invoice_lines SET item_id = ? WHERE id = ?").run(itemId, line.id);
      }
      // Remember the supplier's name for this item (collision-safe, no-op if taken).
      if (line.productName) recordSupplierIdentifier(db, line.productName, itemId);
      addPurchase(db, { itemId, purchasedOn: inv.invoiceDate, quantity: line.quantity, unitCostCents: line.unitCostCents, invoiceId: id });
    }
    db.prepare("UPDATE invoices SET status = 'posted', posted_at = ? WHERE id = ?").run(new Date().toISOString(), id);
```

Add the `PostResolution` type near the top of the module and import `recordSupplierIdentifier` from `./aliases`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- post-invoice-resolutions`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite (guard against posting regressions)**

Run: `npm test`
Expected: PASS. Pay attention to any existing invoice-posting tests — the removal of silent exact-name auto-create is a deliberate behavior change; if an existing test relied on posting an unlinked line with a name that matched an item by exact string, it must now either pre-link the line, pass a resolution, or rely on an existing identifier. Update such tests to the new contract (a line needs an explicit item), and note each change in the report.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/invoices.ts tests/lib/db/post-invoice-resolutions.test.ts
git commit -m "feat(db): postInvoice applies resolutions + remembers supplier names"
```

---

### Task 4: API — post-preview endpoint + resolutions in post

**Files:**
- Create: `src/app/api/invoices/[id]/post-preview/route.ts`
- Modify: `src/app/api/invoices/[id]/post/route.ts` (accept optional `{ resolutions }` body)
- Test: `tests/api/invoice-post-preview.test.ts` (create)

**Interfaces:**
- Consumes: `previewPurchasePost`, `postInvoice` (Tasks 2–3).
- Produces:
  - `GET /api/invoices/[id]/post-preview` → `PostPreview` JSON.
  - `POST /api/invoices/[id]/post` with optional JSON body `{ resolutions?: PostResolution[] }` → passes them to `postInvoice`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/invoice-post-preview.test.ts` (mirror the DB-setup style of `tests/api/*` — they build a DB with `createDb(":memory:")` and call the route handlers directly or the db functions). If the existing api tests call route handlers, follow that; otherwise assert against `previewPurchasePost` through the same path the route uses. Minimum assertions:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { createInvoice, addInvoiceLine, previewPurchasePost } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("post-preview data", () => {
  it("returns needsReview for an unresolved purchase line", () => {
    const item = insertItem(db, { name: "Pokemon Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: null, notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "Pokemon Booster Box Case", quantity: 5, unitCostCents: 400 });
    const pre = previewPurchasePost(db, invId);
    expect(pre.needsReview).toHaveLength(1);
    expect(pre.needsReview[0].suggestedItemId).toBe(item);
  });
});
```

> If the repo's api tests exercise the actual `route.ts` handlers (check one, e.g. `tests/api/move-stock.test.ts`), prefer that style and call the new `GET`/`POST` handlers directly with a mocked request. Match the existing convention rather than inventing one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- invoice-post-preview`
Expected: FAIL (route/data path not wired).

- [ ] **Step 3: Implement**

Create `src/app/api/invoices/[id]/post-preview/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { previewPurchasePost } from "@/lib/db/invoices";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  return NextResponse.json(previewPurchasePost(await dbForRequest(), id));
}
```

Modify `src/app/api/invoices/[id]/post/route.ts` POST to read an optional body:

```typescript
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  try {
    postInvoice(await dbForRequest(), id, Array.isArray(body?.resolutions) ? body.resolutions : []);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Cannot post" }, { status: 400 });
  }
}
```

(The existing DELETE handler in that file is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- invoice-post-preview`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/invoices/[id]/post-preview/route.ts src/app/api/invoices/[id]/post/route.ts tests/api/invoice-post-preview.test.ts
git commit -m "feat(api): invoice post-preview endpoint + resolutions in post"
```

---

### Task 5: Client — preview-then-confirm Post flow

**Files:**
- Modify: `src/components/InvoiceActions.tsx` (Post button previews, opens confirm modal when needed)
- Create: `src/components/invoice/PostReviewModal.tsx`
- Modify: `src/app/invoices/[id]/page.tsx` (pass `items` to `InvoiceActions`)
- Test: none new (no RTL — verified by build + smoke per Global Constraints)

**Interfaces:**
- Consumes: `GET /api/invoices/[id]/post-preview` → `PostPreview`; `POST /api/invoices/[id]/post` with `{ resolutions }`; existing `ItemCombobox`, `Button`.
- Produces: a Post flow that only interrupts when `needsReview` is non-empty.

- [ ] **Step 1: Create the modal component**

Create `src/components/invoice/PostReviewModal.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ItemCombobox } from "@/components/ItemCombobox";

export interface LineReview {
  lineId: number; productName: string;
  suggestedItemId: number | null; suggestedItemName: string | null;
  score: number; confident: boolean;
}
type Resolution = { lineId: number; itemId: number } | { lineId: number; createName: string };

export function PostReviewModal({
  reviews, items, onCancel, onConfirm,
}: {
  reviews: LineReview[];
  items: { id: number; name: string }[];
  onCancel: () => void;
  onConfirm: (resolutions: Resolution[]) => void;
}) {
  // Per line: chosen item id (pre-filled with the suggestion), or "create new" toggle.
  const [choice, setChoice] = useState<Record<number, { itemId: number | null; createNew: boolean }>>(
    () => Object.fromEntries(reviews.map((r) => [r.lineId, { itemId: r.suggestedItemId, createNew: false }])),
  );

  const ready = reviews.every((r) => {
    const c = choice[r.lineId];
    return c.createNew || c.itemId != null;
  });

  function build(): Resolution[] {
    return reviews.map((r) => {
      const c = choice[r.lineId];
      return c.createNew
        ? { lineId: r.lineId, createName: r.productName }
        : { lineId: r.lineId, itemId: c.itemId! };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
        <h2 className="text-lg font-semibold">Confirm items before posting</h2>
        <p className="mt-1 text-sm text-slate-500">{reviews.length} line(s) aren&apos;t linked to an inventory item yet.</p>
        <div className="mt-3 space-y-3">
          {reviews.map((r) => {
            const c = choice[r.lineId];
            const pct = Math.round(r.score * 100);
            return (
              <div key={r.lineId} className="rounded-lg border border-line p-3 text-sm">
                <div className="font-medium">{r.productName}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {r.suggestedItemName
                    ? <>Best match: <span className="font-mono">{r.suggestedItemName}</span> ({pct}%){!r.confident && " — low confidence"}</>
                    : "No match found"}
                </div>
                {!c.createNew && (
                  <div className="mt-2">
                    <ItemCombobox items={items} value={c.itemId}
                      onChange={(id) => setChoice({ ...choice, [r.lineId]: { itemId: id, createNew: false } })}
                      listId={`post-review-${r.lineId}`} placeholder="Search inventory item…" />
                  </div>
                )}
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={c.createNew}
                    onChange={(e) => setChoice({ ...choice, [r.lineId]: { itemId: c.itemId, createNew: e.target.checked } })} />
                  Create a new item named &quot;{r.productName}&quot;
                </label>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button disabled={!ready} onClick={() => onConfirm(build())}>Confirm all &amp; post</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the Post button in `InvoiceActions.tsx`**

Read `src/components/InvoiceActions.tsx` (shown in the plan context) and make these changes:
- Add prop `items: { id: number; name: string }[]` to the component's props.
- Add state: `const [review, setReview] = useState<LineReview[] | null>(null);` (import `LineReview` and `PostReviewModal` from `@/components/invoice/PostReviewModal`).
- Replace the draft Post button's handler. Instead of `onClick={() => call(\`/api/invoices/${id}/post\`, "POST")}`, call a new `startPost`:

```tsx
  async function startPost() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/post-preview`);
      if (!res.ok) { setError("Failed"); setBusy(false); return; }
      const pre = await res.json() as { needsReview: LineReview[] };
      if (pre.needsReview.length === 0) { await doPost([]); return; }
      setBusy(false);
      setReview(pre.needsReview);           // open modal
    } catch { setError("Failed"); setBusy(false); }
  }

  async function doPost(resolutions: unknown[]) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/post`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutions }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
      setReview(null);
      router.refresh();
    } catch { setError("Failed"); setBusy(false); }
  }
```

- Point the draft Post button at `startPost`: `onClick={startPost}`.
- Render the modal when `review` is set, at the end of the returned JSX (before the closing tag):

```tsx
      {review && (
        <PostReviewModal
          reviews={review}
          items={items}
          onCancel={() => setReview(null)}
          onConfirm={(resolutions) => doPost(resolutions)}
        />
      )}
```

(The Unpost/DELETE path still uses the existing `call(...)` — leave it.)

- [ ] **Step 3: Pass `items` from the invoice page**

In `src/app/invoices/[id]/page.tsx`, the page already computes `const items = listItems(db).map((i) => ({ id: i.id, name: i.name }));` for the editor. Pass it to actions:

```tsx
      <InvoiceActions id={invoice.id} status={invoice.status} canPost={lines.length > 0} paid={invoice.paid} items={items} />
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds, no TypeScript errors. Resolve any client/server prop-type mismatch (`LineReview` import is type-only in the client).

- [ ] **Step 5: Manual smoke on the dev copy**

With the dev server on the throwaway copy:
- Create/open a **purchase** invoice, add a line with a free-text product name that resembles an existing item but isn't linked; add another line already linked via the dropdown.
- Click **Post** → the **"Confirm items before posting"** modal appears listing only the unlinked line, with its best-match pre-selected. Confirm → invoice posts, stock is added, and the supplier name is remembered.
- Post a **second** purchase invoice using the same supplier name → it posts with **no** modal (auto-resolved). This is the "remembered forever" payoff.
- A fully-linked invoice posts with no modal (unchanged UX).

- [ ] **Step 6: Commit**

```bash
git add src/components/InvoiceActions.tsx src/components/invoice/PostReviewModal.tsx src/app/invoices/[id]/page.tsx
git commit -m "feat(invoice): confirm unlinked lines at post time (suggest-and-confirm)"
```

---

### Task 6: Full-suite green + build + end-to-end smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS (all prior + the new supplier-identifier, preview, resolutions, and api tests). Any invoice-posting test updated in Task 3 Step 5 must be green.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: End-to-end smoke**

On the dev copy, run the full loop once more and confirm no dev-server console errors: unlinked purchase line → Post → confirm modal → posts + remembers → second invoice with same supplier name auto-resolves (no modal). Also confirm a **sales** invoice with an unlinked line still shows the existing "must map to an item before posting a sale" error (sale path untouched).

- [ ] **Step 4: Final commit (only if fixups were needed)**

```bash
git add -A
git commit -m "chore: finalize invoice supplier suggest-and-confirm"
```

---

## Self-Review

**Spec coverage (design spec "Invoice posting behavior change" + supplier identifiers + the deferred `UNIQUE(code)` hardening):**
- Unlinked purchase line no longer silently exact-name-matches-or-creates → Task 3 removes that path; needs an explicit resolution or an existing identifier. ✓
- Routes unlinked lines through suggest-and-confirm at Post time → Tasks 2 (preview) + 5 (modal). ✓
- Confirmed/linked line writes a `source='supplier'` identifier, remembered permanently → Tasks 1 + 3. ✓
- `UNIQUE(code)` collision hardening before supplier writes (Plan-1 review deferral) → Task 1 `recordSupplierIdentifier` never steals a code. ✓
- Always-ask (never auto-link from a score) → Task 5 modal requires explicit confirm; auto-resolve only via a pre-existing identifier, never a score. ✓
- **Out of scope (later):** SKU-manager UI + item merge (Plan 4); sales-invoice path unchanged.

**Placeholder scan:** none. Tasks 2/4 contain explicit "read the module to confirm the real `createInvoice`/`addInvoiceLine` signatures" instructions — these are genuine adapt-to-existing-code steps (the exact line-insert helper names must be verified), not deferred work; the test intent and assertions are fully specified. Task 5 has no automated test by the node-env/no-RTL Global Constraint.

**Type consistency:** `PostPreview`/`LineReview` (Task 2) are the exact shapes returned by the preview route (Task 4) and consumed by the modal (Task 5, re-declared client-side as a type-only mirror). `PostResolution` (Task 3) is the body threaded through the post route (Task 4) and built by the modal (Task 5). `recordSupplierIdentifier(db, code, itemId) → boolean` (Task 1) is called by `postInvoice` (Task 3).
