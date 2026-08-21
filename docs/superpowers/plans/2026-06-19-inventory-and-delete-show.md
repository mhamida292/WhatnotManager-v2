# Inventory + Delete-Show Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three independent features — delete a single show, manually adjust an item's remaining count, and filter the inventory list — following existing codebase patterns.

**Architecture:** Three independent groups. (A) Delete-show: a `deleteShow` that relies on the existing `ON DELETE CASCADE` FKs, an API DELETE, and a detail-page button mirroring `DeleteItemButton`. (B) Manual remaining: a new signed `qty_adjustment` column folded into `qtyRemaining`, set via `setItemRemaining` so the user types a target and the app stores the delta. (C) Inventory filter: a pure `filterInventory` helper wired into the client `InventoryTable`.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest.

**Specs:**
- `docs/superpowers/specs/2026-06-19-delete-show-design.md`
- `docs/superpowers/specs/2026-06-19-manual-remaining-adjustment-design.md`
- `docs/superpowers/specs/2026-06-19-inventory-filter-design.md`

---

## File structure

- `src/lib/db/shows.ts` — add `deleteShow`, `showDeleteImpact`, `ShowDeleteImpact`.
- `src/app/api/shows/route.ts` — add `DELETE` handler.
- `src/components/DeleteShowButton.tsx` — new client component.
- `src/app/shows/[id]/page.tsx` — render the delete button.
- `src/lib/db/schema.ts` — add `qty_adjustment` column.
- `src/lib/db/connection.ts` — idempotent migration for `qty_adjustment`.
- `src/lib/db/inventory.ts` — `qtyRemaining` includes adjustment; add `setItemRemaining`.
- `src/app/api/inventory/route.ts` — PATCH accepts `targetRemaining`.
- `src/components/EditItemModal.tsx` + `src/components/InventoryTable.tsx` — remaining input; pass prop.
- `src/lib/ui/filter-inventory.ts` — new pure filter helper.

---

# Feature A — Delete a show

## Task A1: deleteShow + showDeleteImpact (DB layer)

**Files:**
- Modify: `src/lib/db/shows.ts`
- Test: `tests/lib/db/shows.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `tests/lib/db/shows.test.ts`. The file already imports `createDb`, `insertItem`, `setAlias`, `saveShow`, `listShows` and sets up `db` via `beforeEach`. Add these imports to the existing top imports: `import { saveShow, getShowWithLines, listShows, deleteShow, showDeleteImpact } from "@/lib/db/shows";` (extend the existing shows import line), and add `import { parseLedger } from "@/lib/csv/ledger";` and `import { saveLedger } from "@/lib/db/ledger";` if not present. Then add a new describe block:

```ts
describe("deleteShow", () => {
  const LEDGER_CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 09:01:00 AM","-$0.78","L2","O2","Charged deduction for giveaway order","completed","SALES","b"`;

  it("deletes a ledger show and cascades its ledger_transactions", () => {
    saveLedger(db, parseLedger(LEDGER_CSV));
    const show = listShows(db).find((s) => s.showDate === "2026-06-14")!;
    expect(db.prepare("SELECT COUNT(*) c FROM ledger_transactions WHERE show_id=?").get(show.id) as any).toMatchObject({ c: 2 });

    deleteShow(db, show.id);

    expect(db.prepare("SELECT COUNT(*) c FROM shows WHERE id=?").get(show.id) as any).toMatchObject({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM ledger_transactions WHERE show_id=?").get(show.id) as any).toMatchObject({ c: 0 });
  });

  it("deletes a manual show and cascades its show_line_items, leaving other shows intact", () => {
    const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", item);
    const keepId = saveShow(db, {
      showDate: "2026-06-10", payoutCents: 100, shippingSuppliesCents: 0, giveawayCount: 0,
      giveawayUnitCents: 500, sourceHash: "keep", lines: [],
    });
    const delId = saveShow(db, {
      showDate: "2026-06-11", payoutCents: 200, shippingSuppliesCents: 0, giveawayCount: 0,
      giveawayUnitCents: 500, sourceHash: "del",
      lines: [{ buyerUsername: "bob", productName: "Cheese Squishy", quantity: 1, revenueCents: 300, status: "confirmed" }],
    });
    expect(db.prepare("SELECT COUNT(*) c FROM show_line_items WHERE show_id=?").get(delId) as any).toMatchObject({ c: 1 });

    deleteShow(db, delId);

    expect(db.prepare("SELECT COUNT(*) c FROM shows WHERE id=?").get(delId) as any).toMatchObject({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM show_line_items WHERE show_id=?").get(delId) as any).toMatchObject({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM shows WHERE id=?").get(keepId) as any).toMatchObject({ c: 1 });
  });

  it("showDeleteImpact reports ledger and line-item counts", () => {
    saveLedger(db, parseLedger(LEDGER_CSV));
    const ledgerShow = listShows(db).find((s) => s.showDate === "2026-06-14")!;
    expect(showDeleteImpact(db, ledgerShow.id)).toEqual({ ledgerTxns: 2, ledgerSales: 1, lineItems: 0 });

    const manualId = saveShow(db, {
      showDate: "2026-06-12", payoutCents: 0, shippingSuppliesCents: 0, giveawayCount: 0,
      giveawayUnitCents: 500, sourceHash: "m",
      lines: [{ buyerUsername: "bob", productName: "X", quantity: 1, revenueCents: 0, status: "confirmed" }],
    });
    expect(showDeleteImpact(db, manualId)).toEqual({ ledgerTxns: 0, ledgerSales: 0, lineItems: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/db/shows.test.ts -t "deleteShow"`
Expected: FAIL — `deleteShow`/`showDeleteImpact` not exported.

- [ ] **Step 3: Implement** — append to `src/lib/db/shows.ts`:

```ts
export interface ShowDeleteImpact {
  ledgerTxns: number;
  ledgerSales: number;
  lineItems: number;
}

/** Counts of rows that a delete would remove, for the confirm dialog. */
export function showDeleteImpact(db: DB, id: number): ShowDeleteImpact {
  const count = (sql: string) => Number((db.prepare(sql).get(id) as { c: number }).c);
  return {
    ledgerTxns: count("SELECT COUNT(*) c FROM ledger_transactions WHERE show_id = ?"),
    ledgerSales: count("SELECT COUNT(*) c FROM ledger_transactions WHERE show_id = ? AND kind = 'sale'"),
    lineItems: count("SELECT COUNT(*) c FROM show_line_items WHERE show_id = ?"),
  };
}

/** Hard-delete a show. show_line_items and ledger_transactions are removed via
 *  their ON DELETE CASCADE FKs (foreign_keys is ON, set in createDb). */
export function deleteShow(db: DB, id: number): void {
  db.transaction(() => {
    db.prepare("DELETE FROM shows WHERE id = ?").run(id);
  })();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/db/shows.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/shows.ts tests/lib/db/shows.test.ts
git commit -m "feat(shows): deleteShow + showDeleteImpact"
```

---

## Task A2: DELETE /api/shows

**Files:**
- Modify: `src/app/api/shows/route.ts`

- [ ] **Step 1: Implement** — in `src/app/api/shows/route.ts`, update the import and add a DELETE handler:

Change the import line to:
```ts
import { saveShow, listShows, deleteShow } from "@/lib/db/shows";
```
Append:
```ts
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM shows WHERE id = ?").get(id);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  deleteShow(db, id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/shows/route.ts
git commit -m "feat(api): DELETE /api/shows removes a show"
```

---

## Task A3: DeleteShowButton + detail page

**Files:**
- Create: `src/components/DeleteShowButton.tsx`
- Modify: `src/app/shows/[id]/page.tsx`

- [ ] **Step 1: Create the button** — `src/components/DeleteShowButton.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShowDeleteImpact } from "@/lib/db/shows";

/** Deletes a show after a confirm spelling out what's removed. Redirects to the
 *  shows list on success. */
export function DeleteShowButton({ id, showDate, impact }: { id: number; showDate: string; impact: ShowDeleteImpact }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  function message(): string {
    let detail = "";
    if (impact.ledgerTxns > 0) {
      const sales = impact.ledgerSales === 1 ? "1 sale" : `${impact.ledgerSales} sales`;
      detail = ` and its ${impact.ledgerTxns} ${impact.ledgerTxns === 1 ? "transaction" : "transactions"} (${sales})`;
    } else if (impact.lineItems > 0) {
      detail = ` and its ${impact.lineItems} ${impact.lineItems === 1 ? "line item" : "line items"}`;
    }
    return `Delete show ${showDate}? This permanently removes the show${detail}. This can't be undone — re-importing the same CSV would recreate it.`;
  }

  async function del() {
    if (!confirm(message())) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/shows", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) { setError(true); setBusy(false); return; }
      router.push("/shows");
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <button onClick={del} disabled={busy}
      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50">
      {error ? "Retry delete" : busy ? "Deleting…" : "Delete show"}
    </button>
  );
}
```

- [ ] **Step 2: Wire into the detail page** — in `src/app/shows/[id]/page.tsx`:

Add imports near the top:
```ts
import { showDeleteImpact } from "@/lib/db/shows";
import { DeleteShowButton } from "@/components/DeleteShowButton";
```
After the existing `const show = rep.shows.find(...)` and its not-found guard (so `show` is non-null), compute:
```ts
  const impact = showDeleteImpact(db, show.showId);
```
At the end of the returned JSX, just before the final closing `</div>` of the page's outer wrapper, add a danger-zone footer:
```tsx
      <div className="border-t border-line pt-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Danger zone</p>
        <DeleteShowButton id={show.showId} showDate={show.showDate} impact={impact} />
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DeleteShowButton.tsx src/app/shows/[id]/page.tsx
git commit -m "feat(shows): delete-show button on the show detail page"
```

---

# Feature B — Manual remaining adjustment

## Task B1: schema column + migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/connection.ts`
- Test: `tests/lib/db/connection.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe("createDb", ...)` block in `tests/lib/db/connection.test.ts`:

```ts
it("inventory_items has a qty_adjustment column defaulting to 0", () => {
  const db = createDb(":memory:");
  const cols = (db.prepare("PRAGMA table_info(inventory_items)").all() as { name: string }[]).map((c) => c.name);
  expect(cols).toContain("qty_adjustment");
  db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased) VALUES ('X', 100, 5)").run();
  const row = db.prepare("SELECT qty_adjustment a FROM inventory_items WHERE name='X'").get() as { a: number };
  expect(row.a).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/connection.test.ts -t "qty_adjustment"`
Expected: FAIL — no such column `qty_adjustment`.

- [ ] **Step 3: Implement**

In `src/lib/db/schema.ts`, in the `inventory_items` CREATE TABLE, add a line immediately after the `qty_samples` column:
```
  qty_adjustment INTEGER NOT NULL DEFAULT 0,
```

In `src/lib/db/connection.ts` `migrate()`, after the existing `qty_samples` block (around line 22), add:
```ts
  if (!cols.includes("qty_adjustment")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN qty_adjustment INTEGER NOT NULL DEFAULT 0");
  }
```
(`cols` is the existing `PRAGMA table_info(inventory_items)` array computed at the top of `migrate`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/connection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts tests/lib/db/connection.test.ts
git commit -m "feat(db): add qty_adjustment column to inventory_items"
```

---

## Task B2: qtyRemaining includes adjustment + setItemRemaining

**Files:**
- Modify: `src/lib/db/inventory.ts`
- Test: `tests/lib/db/inventory.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `tests/lib/db/inventory.test.ts` (extend the existing inventory import to include `setItemRemaining`; the file already imports `insertItem`, `qtyRemaining`, `insertBrotherTxn`, etc.). Add inside `describe("inventory repo", ...)`:

```ts
it("setItemRemaining stores a delta so remaining equals the target", () => {
  const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
  insertBrotherTxn(db, { kind: "gave_to_brother", amountCents: 0, itemId: item, qty: 3 }); // sold = 3
  updateItemSamples(db, item, 1); // base = 10 - 3 - 1 = 6
  expect(qtyRemaining(db, item)).toBe(6);

  setItemRemaining(db, item, 4);
  expect(qtyRemaining(db, item)).toBe(4);
});

it("the remaining adjustment is a persistent delta, not a freeze", () => {
  const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
  setItemRemaining(db, item, 8); // base 10 -> adjustment -2
  expect(qtyRemaining(db, item)).toBe(8);
  insertBrotherTxn(db, { kind: "gave_to_brother", amountCents: 0, itemId: item, qty: 1 }); // one more "sold"
  expect(qtyRemaining(db, item)).toBe(7); // dropped from the corrected baseline
});
```

`insertBrotherTxn` and `updateItemSamples` are already imported in this test file. Signature: `insertBrotherTxn(db, { kind, amountCents, itemId, qty })`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/db/inventory.test.ts -t "setItemRemaining"`
Expected: FAIL — `setItemRemaining` not exported.

- [ ] **Step 3: Implement** — in `src/lib/db/inventory.ts`:

Update `qtyRemaining` to read and add the adjustment:
```ts
export function qtyRemaining(db: DB, itemId: number): number {
  const item = db.prepare("SELECT qty_purchased as q, qty_samples as s, qty_adjustment as a FROM inventory_items WHERE id = ?").get(itemId) as any;
  if (!item) return 0;
  return Number(item.q) - qtySold(db, itemId) - Number(item.s) + Number(item.a);
}
```
Add:
```ts
/** Set an item's remaining to `target` by storing the difference as a signed
 *  adjustment. Affects only the unit count — never cost/COGS/spend. */
export function setItemRemaining(db: DB, id: number, target: number): void {
  const item = db.prepare("SELECT qty_purchased as q, qty_samples as s FROM inventory_items WHERE id = ?").get(id) as { q: number; s: number } | undefined;
  if (!item) return;
  const base = Number(item.q) - qtySold(db, id) - Number(item.s);
  db.prepare("UPDATE inventory_items SET qty_adjustment = ? WHERE id = ?").run(target - base, id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): qty_adjustment folds into qtyRemaining; setItemRemaining"
```

---

## Task B3: PATCH /api/inventory accepts targetRemaining

**Files:**
- Modify: `src/app/api/inventory/route.ts`

- [ ] **Step 1: Implement** — in `src/app/api/inventory/route.ts`:

Add `setItemRemaining` to the import from `@/lib/db/inventory`. In the `PATCH` handler, after the existing `if (body.qtySamples !== undefined) { ... }` block and before `return NextResponse.json({ ok: true });`, add:
```ts
  if (body.targetRemaining !== undefined) {
    const t = Number(body.targetRemaining);
    if (!Number.isInteger(t) || t < 0) return NextResponse.json({ error: "Invalid remaining" }, { status: 400 });
    setItemRemaining(db, id, t);
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/route.ts
git commit -m "feat(api): PATCH /api/inventory accepts targetRemaining"
```

---

## Task B4: Remaining input in EditItemModal

**Files:**
- Modify: `src/components/EditItemModal.tsx`
- Modify: `src/components/InventoryTable.tsx`

- [ ] **Step 1: Implement EditItemModal** — in `src/components/EditItemModal.tsx`:

Add `initialRemaining: number` to the props type and destructure it:
```ts
export function EditItemModal({ itemId, name, initialPurchases, initialSamples, initialRemaining, onClose }: {
  itemId: number; name: string; initialPurchases: PurchaseRow[]; initialSamples: number; initialRemaining: number; onClose: () => void;
}) {
```
Add state after the `samples` state:
```ts
  const [remaining, setRemaining] = useState(String(initialRemaining));
```
Add a save handler after `saveSamples`:
```ts
  async function saveRemaining(v: string) {
    const n = Math.trunc(Number(v));
    if (!(n >= 0)) { setError(true); return; }
    try {
      const res = await fetch("/api/inventory", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: itemId, targetRemaining: n }),
      });
      if (!res.ok) setError(true);
    } catch { setError(true); }
  }
```
Add an input row right after the Samples row (the `div` containing the Samples label/input):
```tsx
        <div className="flex items-center gap-2 text-sm">
          <label className="text-slate-500">Remaining (manual count):</label>
          <input type="number" min="0" className={`w-20 ${INPUT_CLASS}`} value={remaining}
            onChange={(e) => setRemaining(e.target.value)} onBlur={(e) => saveRemaining(e.target.value)} />
        </div>
```

- [ ] **Step 2: Pass the prop** — in `src/components/InventoryTable.tsx`, update the `EditItemModal` usage to pass `initialRemaining`:
```tsx
        <EditItemModal itemId={editing.id} name={editing.name} initialPurchases={editing.purchases}
          initialSamples={editing.qtySamples} initialRemaining={editing.remaining} onClose={() => setEditing(null)} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/EditItemModal.tsx src/components/InventoryTable.tsx
git commit -m "feat(inventory): edit remaining by hand in the item modal"
```

---

# Feature C — Inventory filter

## Task C1: filterInventory helper

**Files:**
- Create: `src/lib/ui/filter-inventory.ts`
- Test: `tests/lib/ui/filter-inventory.test.ts`

- [ ] **Step 1: Write the failing tests** — `tests/lib/ui/filter-inventory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterInventory } from "@/lib/ui/filter-inventory";

const items = [
  { name: "Cheese Squishy", remaining: 10 },
  { name: "Mango Slime", remaining: 2 },
  { name: "Dino Squishy", remaining: 0 },
];

describe("filterInventory", () => {
  it("name search is case-insensitive substring and trims", () => {
    expect(filterInventory(items, { search: "  squISHY ", status: "all" }).map((i) => i.name))
      .toEqual(["Cheese Squishy", "Dino Squishy"]);
  });

  it("empty search returns all", () => {
    expect(filterInventory(items, { search: "", status: "all" })).toHaveLength(3);
  });

  it("status buckets match stock thresholds", () => {
    expect(filterInventory(items, { search: "", status: "out" }).map((i) => i.name)).toEqual(["Dino Squishy"]);
    expect(filterInventory(items, { search: "", status: "low" }).map((i) => i.name)).toEqual(["Mango Slime"]);
    expect(filterInventory(items, { search: "", status: "in" }).map((i) => i.name)).toEqual(["Cheese Squishy"]);
  });

  it("search and status combine with AND", () => {
    expect(filterInventory(items, { search: "squishy", status: "out" }).map((i) => i.name)).toEqual(["Dino Squishy"]);
  });

  it("does not mutate the input", () => {
    const copy = [...items];
    filterInventory(items, { search: "x", status: "out" });
    expect(items).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/ui/filter-inventory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/lib/ui/filter-inventory.ts`:

```ts
import { LOW_STOCK_THRESHOLD } from "@/lib/calc/stock-status";

export type StockFilter = "all" | "in" | "low" | "out";
export interface FilterableItem { name: string; remaining: number; }
export interface InventoryFilter { search: string; status: StockFilter; }

/** Filter inventory rows by name substring (case-insensitive) and stock status.
 *  Status buckets reuse LOW_STOCK_THRESHOLD so they match the stock badge.
 *  Returns a new array; input is not mutated. */
export function filterInventory<T extends FilterableItem>(items: T[], f: InventoryFilter): T[] {
  const q = f.search.trim().toLowerCase();
  return items.filter((i) => {
    if (q && !i.name.toLowerCase().includes(q)) return false;
    switch (f.status) {
      case "out": return i.remaining <= 0;
      case "low": return i.remaining > 0 && i.remaining <= LOW_STOCK_THRESHOLD;
      case "in":  return i.remaining > LOW_STOCK_THRESHOLD;
      default:    return true;
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/ui/filter-inventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/filter-inventory.ts tests/lib/ui/filter-inventory.test.ts
git commit -m "feat(inventory): filterInventory helper (name + stock status)"
```

---

## Task C2: Wire filter into InventoryTable

**Files:**
- Modify: `src/components/InventoryTable.tsx`

- [ ] **Step 1: Implement** — in `src/components/InventoryTable.tsx`:

Add imports:
```ts
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { filterInventory, type StockFilter } from "@/lib/ui/filter-inventory";
```
Add state inside the component (next to the sort state):
```ts
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StockFilter>("all");
```
Change the list derivation to filter before sorting:
```ts
  const sorted = sortInventory(filterInventory(items, { search, status }), key, dir);
```
Add a filter bar in the top control row. Replace the existing:
```tsx
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>+ Add product</Button>
      </div>
```
with:
```tsx
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" placeholder="Search items…" className={`w-48 ${INPUT_CLASS}`}
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={INPUT_CLASS} value={status} onChange={(e) => setStatus(e.target.value as StockFilter)}>
          <option value="all">All</option>
          <option value="in">In stock</option>
          <option value="low">Low</option>
          <option value="out">Out</option>
        </select>
        <div className="ml-auto"><Button onClick={() => setAdding(true)}>+ Add product</Button></div>
      </div>
```
In the table body, add an empty-state row when nothing matches. Right after the `<DataTable head={...}>` opening (before `{sorted.map(...)}`), add:
```tsx
        {sorted.length === 0 && (
          <tr><td colSpan={COLUMNS.length + 1} className="px-3 py-3 text-slate-500">No items match your filters.</td></tr>
        )}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/InventoryTable.tsx
git commit -m "feat(inventory): name + stock-status filter bar on the table"
```

---

## Task D: Final verification

**Files:** none (verification)

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all tests pass (133 prior + new cases).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke-test in the app**

Start `npm run dev`. Verify:
- `/shows/<id>` shows a "Delete show" button; deleting redirects to `/shows` and the show is gone (use a throwaway: re-import restores it).
- On `/inventory`, the Edit modal has a "Remaining (manual count)" field; setting it changes the row's Remaining without changing Avg cost or spend.
- The inventory search box and status dropdown filter the rows; clearing them restores all.

Stop the dev server when done.

---

## Notes for the executor

- Features A, B, C are independent; tasks within each are ordered. If a task's referenced helper signature differs slightly from the codebase (e.g. `insertBrotherTxn` args in B2), adapt the call to the real signature — the asserted behavior (`qtySold`/`qtyRemaining` values) is what matters.
- Follow existing patterns: `DeleteShowButton` mirrors `DeleteItemButton`; the remaining input mirrors the samples input; the migration mirrors the `qty_samples` add.
- Do not push; the controller handles branch finishing.
