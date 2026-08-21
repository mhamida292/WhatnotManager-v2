# Unified Item Identifiers — Plan 5: Item Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user fix accidental duplicate items by **merging** one item into another: move all of the loser's identifiers and history onto the survivor, recompute the survivor's stock totals, and delete the loser — atomically.

**Architecture:** A single transactional `mergeItems(db, { loserId, survivorId })` re-points `item_id` from loser→survivor across the eight history tables, moves the loser's non-`mine` identifiers to the survivor, recomputes the survivor's `qty_purchased`/`unit_cost_cents` from the merged purchase batches, then deletes the loser (whose remaining `mine` identifier is cleared by the existing `ON DELETE CASCADE`). A thin `POST /api/inventory/merge` route wraps it, and a `MergeItemButton` in the item detail page's danger zone lets the user pick a survivor and confirm. This is the ONLY operation that rewrites `item_id` on posted rows, and only on explicit user action.

**Tech Stack:** Next.js (App Router), TypeScript, better-sqlite3, Vitest (node env — no React Testing Library).

## Global Constraints

- **Merge direction:** on item X's page, "merge this item into <target>" makes **X the loser** (deleted) and the chosen target the **survivor** (kept). All of X's history and identifiers move to the survivor.
- **Atomic:** the whole merge runs in one `db.transaction`. A failure rolls back entirely — no half-merged state, no orphaned rows.
- **Eight history tables re-point** loser→survivor via `UPDATE <t> SET item_id = survivor WHERE item_id = loser`: `invoice_lines`, `inventory_adjustments`, `inventory_moves`, `item_purchases`, `brother_transactions`, `show_line_items`, `ledger_transactions`, `bundle_components`. (These are every table with an `item_id` FK to `inventory_items` except `item_identifiers`, handled specially.)
- **Identifiers:** move the loser's `supplier`/`whatnot` identifiers to the survivor (`UPDATE item_identifiers SET item_id = survivor WHERE item_id = loser AND source != 'mine'`). Do NOT move the loser's `mine` row (the survivor keeps its own SKU); it remains on the loser and is removed by `ON DELETE CASCADE` when the loser is deleted. **No code-collision handling is needed:** `item_identifiers.code` is a GLOBAL `UNIQUE(code)`, so two different items can never hold the same code — the re-point can never violate the constraint.
- **Recompute survivor totals** after re-pointing purchases: call `recomputeItemTotals(db, survivorId)` (`@/lib/db/purchases`) — it sets `qty_purchased` = Σ batch quantities and `unit_cost_cents` = weighted average from `item_purchases`.
- **Guards:** `loserId === survivorId` → reject; either item missing → reject. Return a typed result (no throw for these expected rejections).
- Test env is node (`vitest.config.ts`), NO React Testing Library. The button (Task 3) has NO unit test — verified by `npm run build` + controller live smoke. Do NOT add a test that renders a React component.
- Client "navigate after success" uses `router.push("/inventory")` (the loser's page no longer exists), matching `DeleteItemButton`.

---

### Task 1: `mergeItems` — transactional item merge

**Files:**
- Modify: `src/lib/db/inventory.ts` (add function; keep existing exports)
- Test: `tests/lib/db/merge-items.test.ts` (create)

**Interfaces:**
- Consumes: `recomputeItemTotals` (`@/lib/db/purchases`).
- Produces:
  ```typescript
  export type MergeResult = { ok: true } | { ok: false; reason: "same_item" | "loser_not_found" | "survivor_not_found" };
  /** Merge loser into survivor: re-point all history + non-mine identifiers to
   *  survivor, recompute survivor totals, delete loser. Atomic. */
  export function mergeItems(db: DB, p: { loserId: number; survivorId: number }): MergeResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/merge-items.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, mergeItems, qtyRemaining, identifiersForItem } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { setAlias, recordSupplierIdentifier, resolveItemId } from "@/lib/db/aliases";
import { addAdjustment } from "@/lib/db/adjustments";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("mergeItems", () => {
  it("moves purchases, identifiers, and adjustments onto the survivor and deletes the loser", () => {
    const survivor = insertItem(db, { name: "Real Booster", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const loser = insertItem(db, { name: "Dup Booster", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    // survivor: 5 units purchased; loser: 8 units + a supplier code + a whatnot alias + a -2 adjustment
    addPurchase(db, { itemId: survivor, purchasedOn: "2026-07-01", quantity: 5, unitCostCents: 400 });
    addPurchase(db, { itemId: loser, purchasedOn: "2026-07-02", quantity: 8, unitCostCents: 400 });
    recordSupplierIdentifier(db, "ACME-DUP", loser);
    setAlias(db, "Booster Dupe Name", loser);
    addAdjustment(db, { itemId: loser, reason: "damage_loss", qty: -2, adjustedOn: "2026-07-03", note: null });

    const r = mergeItems(db, { loserId: loser, survivorId: survivor });
    expect(r).toEqual({ ok: true });

    // loser gone
    expect(db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(loser)).toBeUndefined();
    // survivor now has 5 + 8 = 13 purchased, minus 2 adjustment = 11 remaining
    expect(qtyRemaining(db, survivor)).toBe(11);
    // loser's supplier + whatnot identifiers now resolve to the survivor
    expect(resolveItemId(db, "ACME-DUP")).toBe(survivor);
    expect(resolveItemId(db, "Booster Dupe Name")).toBe(survivor);
    // survivor identifier list includes its own mine + the moved supplier + whatnot (loser's mine gone)
    const sources = identifiersForItem(db, survivor).map((i) => i.source).sort();
    expect(sources).toEqual(["mine", "supplier", "whatnot"]);
    // loser's mine sku no longer resolves (row cascade-deleted with the loser)
    expect(resolveItemId(db, "ITEM-00002")).toBeNull();
  });

  it("rejects merging an item into itself", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    expect(mergeItems(db, { loserId: a, survivorId: a })).toEqual({ ok: false, reason: "same_item" });
  });

  it("rejects when the survivor or loser does not exist", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    expect(mergeItems(db, { loserId: a, survivorId: 9999 })).toEqual({ ok: false, reason: "survivor_not_found" });
    expect(mergeItems(db, { loserId: 9999, survivorId: a })).toEqual({ ok: false, reason: "loser_not_found" });
  });

  it("re-points wholesale invoice lines so survivor stock reflects them", () => {
    const survivor = insertItem(db, { name: "Real", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const loser = insertItem(db, { name: "Dup", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: loser, purchasedOn: "2026-07-01", quantity: 10, unitCostCents: 100 });
    // a posted SALE invoice line against the loser (wholesale sold 3)
    const inv = db.prepare("INSERT INTO invoices (direction, status, invoice_date) VALUES ('sale','posted','2026-07-02')").run().lastInsertRowid;
    db.prepare("INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents) VALUES (?,?,?,?,?)")
      .run(inv, loser, "Dup", 3, 100);

    mergeItems(db, { loserId: loser, survivorId: survivor });
    // survivor: 10 purchased − 3 wholesale sold = 7 remaining
    expect(qtyRemaining(db, survivor)).toBe(7);
  });
});
```

> Verify `addAdjustment`'s real signature in `src/lib/db/adjustments.ts` before running (the test uses `{ itemId, reason, qty, adjustedOn, note }`); adjust the call to match the actual exported shape if it differs. Same for `addPurchase` (confirmed: `{ itemId, purchasedOn, quantity, unitCostCents }`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- merge-items`
Expected: FAIL (`mergeItems` not a function).

- [ ] **Step 3: Implement**

In `src/lib/db/inventory.ts`, add (import `recomputeItemTotals` from `./purchases` if not present):

```typescript
export type MergeResult = { ok: true } | { ok: false; reason: "same_item" | "loser_not_found" | "survivor_not_found" };

const MERGE_ITEM_TABLES = [
  "invoice_lines", "inventory_adjustments", "inventory_moves", "item_purchases",
  "brother_transactions", "show_line_items", "ledger_transactions", "bundle_components",
] as const;

export function mergeItems(db: DB, p: { loserId: number; survivorId: number }): MergeResult {
  if (p.loserId === p.survivorId) return { ok: false, reason: "same_item" };
  const survivor = db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(p.survivorId);
  if (!survivor) return { ok: false, reason: "survivor_not_found" };
  const loser = db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(p.loserId);
  if (!loser) return { ok: false, reason: "loser_not_found" };

  const tx = db.transaction(() => {
    for (const t of MERGE_ITEM_TABLES) {
      db.prepare(`UPDATE ${t} SET item_id = ? WHERE item_id = ?`).run(p.survivorId, p.loserId);
    }
    // Move the loser's non-identity identifiers; global UNIQUE(code) guarantees no collision.
    db.prepare("UPDATE item_identifiers SET item_id = ? WHERE item_id = ? AND source != 'mine'").run(p.survivorId, p.loserId);
    // Recompute survivor totals from the now-merged purchase batches.
    recomputeItemTotals(db, p.survivorId);
    // Delete the loser; its remaining 'mine' identifier goes via ON DELETE CASCADE.
    db.prepare("DELETE FROM inventory_items WHERE id = ?").run(p.loserId);
  });
  tx();
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- merge-items`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/merge-items.test.ts
git commit -m "feat(db): mergeItems re-points history + identifiers, recomputes, deletes loser"
```

---

### Task 2: API — `POST /api/inventory/merge`

**Files:**
- Create: `src/app/api/inventory/merge/route.ts`
- Test: `tests/api/merge-api.test.ts` (create)

**Interfaces:**
- Consumes: `mergeItems` (Task 1).
- Produces: `POST /api/inventory/merge` body `{ loserId, survivorId }` → `{ ok: true }` or 400 `{ error }` (same_item / not_found).

- [ ] **Step 1: Write the failing test**

Create `tests/api/merge-api.test.ts` (data-layer style, matching the repo's `tests/api/*`):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, mergeItems, qtyRemaining } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("merge api (data layer)", () => {
  it("merges and combines stock", () => {
    const survivor = insertItem(db, { name: "Real", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const loser = insertItem(db, { name: "Dup", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: survivor, purchasedOn: "2026-07-01", quantity: 4, unitCostCents: 100 });
    addPurchase(db, { itemId: loser, purchasedOn: "2026-07-01", quantity: 6, unitCostCents: 100 });
    expect(mergeItems(db, { loserId: loser, survivorId: survivor })).toEqual({ ok: true });
    expect(qtyRemaining(db, survivor)).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails/passes**

Run: `npm test -- merge-api`
Expected: PASS once Task 1 is in (this asserts the data layer the route wraps). Still create the route below and keep this as a guard.

- [ ] **Step 3: Implement the route**

Create `src/app/api/inventory/merge/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { mergeItems } from "@/lib/db/inventory";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const loserId = Number(b.loserId);
  const survivorId = Number(b.survivorId);
  if (!Number.isInteger(loserId) || !Number.isInteger(survivorId))
    return NextResponse.json({ error: "Invalid merge" }, { status: 400 });
  const r = mergeItems(await dbForRequest(), { loserId, survivorId });
  if (!r.ok) {
    const msg = r.reason === "same_item" ? "Cannot merge an item into itself" : "Item not found";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run the test + build**

Run: `npm test -- merge-api` then `npm run build`
Expected: test PASS; build succeeds (new route registered).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/inventory/merge/route.ts tests/api/merge-api.test.ts
git commit -m "feat(api): POST /api/inventory/merge"
```

---

### Task 3: UI — `MergeItemButton` in the item detail danger zone

**Files:**
- Create: `src/components/inventory/MergeItemButton.tsx`
- Modify: `src/app/inventory/[id]/page.tsx` (render it in the danger zone; pass other items)
- Test: none new (no RTL — build + smoke per Global Constraints)

**Interfaces:**
- Consumes: `POST /api/inventory/merge`; existing `ItemCombobox`, `Button`.
- Produces: a control to pick a survivor item and merge the current item into it, with a strong confirm.

- [ ] **Step 1: Create the component**

Create `src/components/inventory/MergeItemButton.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ItemCombobox } from "@/components/ItemCombobox";

/** Merge THIS item (the loser) into a chosen survivor. All of this item's
 *  purchases, sales, adjustments, and identifiers move to the survivor and this
 *  item is deleted. Irreversible — confirms first. */
export function MergeItemButton({ itemId, itemName, others }: {
  itemId: number; itemName: string; others: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [survivorId, setSurvivorId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    if (survivorId == null) return;
    const survivorName = others.find((o) => o.id === survivorId)?.name ?? "the selected item";
    if (!confirm(`Merge "${itemName}" into "${survivorName}"? All of "${itemName}"'s purchases, sales, adjustments, and identifiers move to "${survivorName}", and "${itemName}" is permanently deleted. This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/inventory/merge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loserId: itemId, survivorId }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
      router.push("/inventory");
    } catch { setError("Failed"); setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-[220px]">
        <ItemCombobox items={others} value={survivorId} onChange={setSurvivorId} listId="merge-survivor" placeholder="Merge into which item?" />
      </div>
      <Button variant="secondary" onClick={merge} disabled={busy || survivorId == null}>Merge</Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the item detail page danger zone**

In `src/app/inventory/[id]/page.tsx`:
- Import: `import { MergeItemButton } from "@/components/inventory/MergeItemButton";` and (if not already available) `listItems` — the page already imports from `@/lib/db/inventory`; add `listItems` to that import.
- Compute the other active items (exclude self and archived): near the other reads add
  ```typescript
  const others = listItems(db).filter((i) => i.id !== itemId && i.archivedAt == null).map((i) => ({ id: i.id, name: i.name }));
  ```
- In the "Danger zone" block, add the merge control above (or below) the existing `<DeleteItemButton …/>`:
  ```tsx
        <div className="mb-3">
          <p className="mb-1 text-xs text-slate-400">Merge this item into another (fixes a duplicate). This item&apos;s history and identifiers move to the target; this item is deleted.</p>
          <MergeItemButton itemId={item.id} itemName={item.name} others={others} />
        </div>
  ```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds, no type errors.

- [ ] **Step 4: Manual smoke on the dev copy**

With two duplicate-ish items: open the loser's detail page → in Danger zone pick the survivor → Merge → confirm → redirected to Inventory; the loser is gone; the survivor's stock reflects both items' purchases/sales, and the survivor's Identifiers panel shows the loser's former supplier/Whatnot codes.

- [ ] **Step 5: Commit**

```bash
git add src/components/inventory/MergeItemButton.tsx src/app/inventory/[id]/page.tsx
git commit -m "feat(inventory): merge item into another from the danger zone"
```

---

### Task 4: Full-suite green + build + end-to-end smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite** — Run: `npm test` — Expected: PASS (prior count + merge-items + merge-api tests).
- [ ] **Step 2: Build** — Run: `npm run build` — Expected: succeeds.
- [ ] **Step 3: End-to-end smoke** — On the dev copy: create/pick two items, give the loser a purchase and a supplier identifier, merge it into the survivor, and confirm: loser gone from Inventory; survivor remaining = combined; survivor Identifiers panel shows the moved code; resolving the loser's old supplier code returns the survivor. Confirm no dev-server console errors, and that the Inventory list and the survivor's page still render.
- [ ] **Step 4: Final commit (only if fixups were needed)**

```bash
git add -A && git commit -m "chore: finalize item merge"
```

---

## Self-Review

**Spec coverage (design spec "Merge two items"):**
- Move the merged item's identifiers AND stock history onto the survivor by re-pointing `item_id`, then delete the emptied item → Task 1 (8 history tables + non-mine identifiers). ✓
- Only operation that rewrites `item_id` on posted rows, only on explicit user action → Task 1 (function) + Task 3 (explicit confirm). ✓
- Guard against `UNIQUE(code)` collision if both items share a code → N/A by construction (global `UNIQUE(code)` means two items can't share a code); documented in Global Constraints so a reviewer doesn't expect collision-handling code. ✓
- Recompute survivor totals so stock/COGS stay correct → Task 1 (`recomputeItemTotals`). ✓

**Placeholder scan:** none. Task 1 flags one verify-signature step (`addAdjustment` shape) — a genuine adapt-to-existing step with the intended fields given. Task 3 has no automated test by the node-env/no-RTL constraint.

**Type consistency:** `MergeResult` (Task 1) is consumed by the route (Task 2). `POST /api/inventory/merge` body `{ loserId, survivorId }` matches the client call (Task 3). `MERGE_ITEM_TABLES` covers exactly the eight `item_id` FK tables other than `item_identifiers` (verified against schema: invoice_lines, inventory_adjustments, inventory_moves, item_purchases, brother_transactions, show_line_items, ledger_transactions, bundle_components).
