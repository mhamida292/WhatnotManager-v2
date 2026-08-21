# Delete Inventory Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user delete an inventory item from its detail page, with a confirmation that spells out exactly what gets detached.

**Architecture:** A transactional `deleteItem` db function removes the item's aliases, nulls `item_id` on referencing legacy rows, and deletes the item row. A `deleteImpact` function returns the counts shown in the warning. A `DELETE /api/inventory` handler exposes it; a client `DeleteItemButton` (modeled on the existing `UnmapButton`) confirms, calls it, and redirects to the inventory list.

**Tech Stack:** Next.js App Router (route handlers + server components), better-sqlite3, vitest. Spec: `docs/superpowers/specs/2026-06-15-delete-inventory-item-design.md`.

---

### Task 1: `deleteItem` db function (transactional cascade)

**Files:**
- Modify: `src/lib/db/inventory.ts`
- Test: `tests/lib/db/inventory.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe("inventory repo", ...)` block in `tests/lib/db/inventory.test.ts` (import `deleteItem` and `resolveItemId` — see Step 3 note). The setup mirrors the existing ledger test in this file.

```ts
it("deleteItem removes the item and frees its mapped names (ledger sales survive)", () => {
  const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
  saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$1.00","L2","O2","Earnings for selling a Cheese Squishy #9","processing","SALES",""`));
  setAlias(db, "Cheese Squishy", id);
  expect(qtySold(db, id)).toBe(2);

  deleteItem(db, id);

  expect(listItems(db)).toHaveLength(0);                 // item gone
  expect(resolveItemId(db, "Cheese Squishy")).toBeNull(); // alias gone -> name unmapped
  // Ledger rows survive: re-adding + re-mapping re-counts them.
  const id2 = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
  setAlias(db, "Cheese Squishy", id2);
  expect(qtySold(db, id2)).toBe(2);
});

it("deleteItem nulls item_id on referencing legacy show and brother rows (keeps the rows)", () => {
  const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: null });
  db.prepare("INSERT INTO shows (show_date) VALUES ('2026-06-10')").run();
  const showId = (db.prepare("SELECT id FROM shows").get() as any).id;
  db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
              VALUES (?, 'Cheese Squishy', 5, 'confirmed', ?)`).run(showId, id);
  insertBrotherTxn(db, { kind: "gave_to_brother", amountCents: 0, itemId: id, qty: 3 });

  deleteItem(db, id);

  expect(db.prepare("SELECT COUNT(*) n FROM show_line_items").get()).toMatchObject({ n: 1 });
  expect(db.prepare("SELECT item_id FROM show_line_items").get()).toMatchObject({ item_id: null });
  expect(db.prepare("SELECT COUNT(*) n FROM brother_transactions").get()).toMatchObject({ n: 1 });
  expect(db.prepare("SELECT item_id FROM brother_transactions").get()).toMatchObject({ item_id: null });
});

it("deleteItem on an item with no references just removes the row", () => {
  const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 5, lotId: null });
  deleteItem(db, id);
  expect(listItems(db)).toHaveLength(0);
});
```

Add `deleteItem` to the existing import from `@/lib/db/inventory` at the top of the file, and add `resolveItemId` to the existing import from `@/lib/db/aliases` (which already imports `setAlias`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: FAIL — `deleteItem is not a function` (or import error).

- [ ] **Step 3: Implement `deleteItem`**

Add to `src/lib/db/inventory.ts` (after `updateItemSamples`, near the other mutators):

```ts
/** Delete an item: removes its alias mappings (freed Whatnot names become
 *  unmapped — recoverable by re-adding + re-mapping), detaches legacy show and
 *  brother rows (item_id -> NULL, rows kept), then deletes the item. Atomic. */
export function deleteItem(db: DB, id: number): void {
  const tx = db.transaction((itemId: number) => {
    db.prepare("DELETE FROM product_aliases WHERE item_id = ?").run(itemId);
    db.prepare("UPDATE show_line_items SET item_id = NULL WHERE item_id = ?").run(itemId);
    db.prepare("UPDATE brother_transactions SET item_id = NULL WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM inventory_items WHERE id = ?").run(itemId);
  });
  tx(id);
}
```

Atomicity (the spec's "rollback leaves everything intact" requirement) is provided by better-sqlite3's `db.transaction()` wrapper: if any statement throws, the whole transaction rolls back. No explicit fault-injection test is included — it would require contorting the function to throw mid-step, and the guarantee is structural, not behavioral logic we own.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: PASS (all tests, including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): deleteItem — transactional cascade (aliases + legacy links)"
```

---

### Task 2: `deleteImpact` counts for the warning

**Files:**
- Modify: `src/lib/db/inventory.ts`
- Test: `tests/lib/db/inventory.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the same `describe` block. Add `deleteImpact` to the `@/lib/db/inventory` import.

```ts
it("deleteImpact reports mappings, ledger sales, legacy show sales, and brother txns", () => {
  const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: null });
  saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$1.00","L2","O2","Earnings for selling a Cheese Squishy #9","processing","SALES",""`));
  setAlias(db, "Cheese Squishy", id);
  db.prepare("INSERT INTO shows (show_date) VALUES ('2026-06-10')").run();
  const showId = (db.prepare("SELECT id FROM shows").get() as any).id;
  db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
              VALUES (?, 'Cheese Squishy', 5, 'confirmed', ?)`).run(showId, id);
  insertBrotherTxn(db, { kind: "gave_to_brother", amountCents: 0, itemId: id, qty: 3 });

  expect(deleteImpact(db, id)).toEqual({ mappings: 1, ledgerSales: 2, showLineSales: 1, brotherTxns: 1 });
});

it("deleteImpact is all zeros for a fresh item", () => {
  const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 5, lotId: null });
  expect(deleteImpact(db, id)).toEqual({ mappings: 0, ledgerSales: 0, showLineSales: 0, brotherTxns: 0 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: FAIL — `deleteImpact is not a function`.

- [ ] **Step 3: Implement `deleteImpact`**

Add to `src/lib/db/inventory.ts` (next to `deleteItem`). `ledgerSales` mirrors `qtySoldFromLedger` (each sale row = one unit) so the warning matches the page's "Sold — ledger sales".

```ts
export interface DeleteImpact { mappings: number; ledgerSales: number; showLineSales: number; brotherTxns: number; }

/** Counts of what a delete will detach, for the confirmation warning. */
export function deleteImpact(db: DB, itemId: number): DeleteImpact {
  const one = (sql: string) => Number((db.prepare(sql).get(itemId) as any).n);
  return {
    mappings: one("SELECT COUNT(*) n FROM product_aliases WHERE item_id = ?"),
    ledgerSales: Number((db.prepare(`SELECT COUNT(*) n FROM ledger_transactions lt
        JOIN product_aliases pa ON pa.product_name = lt.product_name
        WHERE lt.kind = 'sale' AND pa.item_id = ?`).get(itemId) as any).n),
    showLineSales: one("SELECT COUNT(*) n FROM show_line_items WHERE item_id = ?"),
    brotherTxns: one("SELECT COUNT(*) n FROM brother_transactions WHERE item_id = ?"),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): deleteImpact — counts shown in the delete warning"
```

---

### Task 3: `DELETE /api/inventory` route handler

**Files:**
- Modify: `src/app/api/inventory/route.ts`

No test (thin route handler — consistent with the codebase, which leaves routes untested and covers the db layer thoroughly).

- [ ] **Step 1: Add the DELETE handler**

Add `deleteItem` to the existing import from `@/lib/db/inventory` in `src/app/api/inventory/route.ts`, then append:

```ts
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(id);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  deleteItem(db, id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/route.ts
git commit -m "feat(api): DELETE /api/inventory removes an item"
```

---

### Task 4: `DeleteItemButton` client component

**Files:**
- Create: `src/components/DeleteItemButton.tsx`

Modeled on `src/components/UnmapButton.tsx` (confirm → fetch → refresh/redirect, with a Retry state).

- [ ] **Step 1: Create the component**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeleteImpact } from "@/lib/db/inventory";

/** Deletes an inventory item after a confirm that spells out the blast radius.
 *  Ledger mappings are recoverable (re-add + re-map); legacy show/brother links
 *  are not. Redirects to the inventory list on success. */
export function DeleteItemButton({ id, name, impact }: { id: number; name: string; impact: DeleteImpact }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  function message(): string {
    const parts: string[] = [];
    if (impact.mappings > 0) {
      const sales = impact.ledgerSales === 1 ? "1 ledger sale" : `${impact.ledgerSales} ledger sales`;
      parts.push(`removes ${impact.mappings === 1 ? "1 mapping" : `${impact.mappings} mappings`} (${sales} will become unmapped)`);
    }
    if (impact.showLineSales > 0) parts.push(`clears the item from ${impact.showLineSales} legacy show ${impact.showLineSales === 1 ? "sale" : "sales"}`);
    if (impact.brotherTxns > 0) parts.push(`clears the item from ${impact.brotherTxns} brother ${impact.brotherTxns === 1 ? "transaction" : "transactions"}`);
    const detail = parts.length ? ` This ${parts.join(" and ")}.` : "";
    return `Delete "${name}"?${detail} The sales data is kept — re-add and re-map to restore ledger counts.`;
  }

  async function del() {
    if (!confirm(message())) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/inventory", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) { setError(true); setBusy(false); return; }
      router.push("/inventory");
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <button onClick={del} disabled={busy}
      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50">
      {error ? "Retry delete" : busy ? "Deleting…" : "Delete item"}
    </button>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DeleteItemButton.tsx
git commit -m "feat(ui): DeleteItemButton — confirm with blast radius, redirect on delete"
```

---

### Task 5: Wire the button into the item detail page

**Files:**
- Modify: `src/app/inventory/[id]/page.tsx`

- [ ] **Step 1: Add the import and compute the impact**

At the top of `src/app/inventory/[id]/page.tsx`, add `deleteImpact` to the existing import from `@/lib/db/inventory`, and add:

```tsx
import { DeleteItemButton } from "@/components/DeleteItemButton";
```

In the component body, alongside the existing `const sales = ledgerSalesForItem(db, itemId);` line, add:

```tsx
const impact = deleteImpact(db, itemId);
```

- [ ] **Step 2: Render the button at the bottom**

Immediately before the final closing `</div>` of the returned JSX (after the "Ledger sales" block's closing `</div>`), add a danger-zone section:

```tsx
      <div className="border-t border-line pt-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-600">Danger zone</h2>
        <p className="mb-2 text-xs text-slate-400">
          Deleting unmaps this item&apos;s Whatnot names and removes it from inventory. Sales data is kept; re-add and re-map to restore counts.
        </p>
        <DeleteItemButton id={item.id} name={item.name} impact={impact} />
      </div>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify the flow**

Run: `npm run dev`, open `http://localhost:3000/inventory`, click an item, click **Delete item**. Confirm the dialog text matches the item's mappings/sales, accept, and verify it redirects to `/inventory` with the item gone and (if it had mapped names) those names now showing as unmapped on the inventory page.

- [ ] **Step 5: Commit**

```bash
git add "src/app/inventory/[id]/page.tsx"
git commit -m "feat(inventory): delete action on the item detail page"
```

---

### Task 6: Full test + typecheck sweep

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build (catches App Router issues)**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit (only if any fixups were needed)**

```bash
git add -A
git commit -m "chore: fixups from delete-item verification sweep"
```
