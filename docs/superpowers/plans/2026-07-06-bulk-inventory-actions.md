# Bulk Inventory Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user select multiple inventory items and bulk Archive/Unarchive or Delete them, with an aggregate impact confirmation before bulk delete.

**Architecture:** Transactional batch db helpers that wrap the existing single-item `archiveItem`/`unarchiveItem`/`deleteItem`/`deleteImpact`. A `POST /api/inventory/bulk` route dispatches by action; a `bulk-delete-impact` route feeds the confirm. `InventoryTable` and a new `ArchivedTable` client component gain checkbox selection + a shared `BulkActionBar`. Bulk delete uses a native `confirm()` populated with the aggregate impact (matching the existing `DeleteItemButton` convention — no bespoke modal).

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest, Tailwind.

## Global Constraints

- Every db function takes a `db: DB` handle first (multi-workspace: never call `getDb` in business logic).
- Server components / API routes resolve the db via `await dbForRequest()`.
- Route params are async where present (`{ params }: { params: Promise<...> }`).
- **Invariant:** archive/unarchive is organizational only — no calc/report code changes; `buildLedgerReport`/`qtyRemaining` unchanged by (un)archiving. Delete keeps its existing cascade (unmap aliases; NULL cached `item_id` on ledger/show/brother rows; keep the rows).
- Batch helpers run in ONE transaction (all-or-nothing). Unknown ids are harmless no-ops (single-item fns already no-op on missing rows).
- Bulk delete confirmation uses native `confirm()` with an aggregate impact message (matches `src/components/DeleteItemButton.tsx`); no new modal component.
- Follow existing file style (semicolons, `@/` alias, small focused modules).
- The only tolerated pre-existing `tsc` error is `tests/lib/db/giveaway-items.test.ts` — ignore it; changed files must be clean.

---

### Task 1: Batch db helpers + aggregate impact

**Files:**
- Modify: `src/lib/db/inventory.ts`
- Modify: `tests/lib/db/inventory.test.ts`

**Interfaces:**
- Consumes: existing `archiveItem`, `unarchiveItem`, `deleteItem`, `deleteImpact`, `DeleteImpact`.
- Produces:
  - `archiveItems(db: DB, ids: number[]): void`
  - `unarchiveItems(db: DB, ids: number[]): void`
  - `deleteItems(db: DB, ids: number[]): void`
  - `interface BulkDeleteImpact { items: number; mappings: number; ledgerSales: number; showLineSales: number; brotherTxns: number }`
  - `bulkDeleteImpact(db: DB, ids: number[]): BulkDeleteImpact`

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/db/inventory.test.ts` (ensure imports include `archiveItems, unarchiveItems, deleteItems, bulkDeleteImpact, listItems, insertItem` from `@/lib/db/inventory`, `setAlias` from `@/lib/db/aliases`, `parseLedger` from `@/lib/csv/ledger`, `saveLedger` from `@/lib/db/ledger`, `buildLedgerReport` from `@/lib/calc/ledger-report`):

```typescript
describe("bulk inventory actions", () => {
  it("archiveItems / unarchiveItems set/clear archived_at on all given ids only", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const c = insertItem(db, { name: "C", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    archiveItems(db, [a, b]);
    const byId = () => Object.fromEntries(listItems(db).map((i) => [i.id, i.archivedAt]));
    let m = byId();
    expect(m[a]).not.toBeNull();
    expect(m[b]).not.toBeNull();
    expect(m[c]).toBeNull();
    unarchiveItems(db, [a, b]);
    m = byId();
    expect(m[a]).toBeNull();
    expect(m[b]).toBeNull();
  });

  it("deleteItems removes all given ids atomically", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const c = insertItem(db, { name: "C", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    deleteItems(db, [a, b]);
    const ids = listItems(db).map((i) => i.id);
    expect(ids).toEqual([c]);
  });

  it("bulkDeleteImpact sums per-item deleteImpact and counts items", () => {
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""`;
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 5, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    saveLedger(db, parseLedger(csv));
    const plain = insertItem(db, { name: "Plain", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const agg = bulkDeleteImpact(db, [cheese, plain]);
    expect(agg.items).toBe(2);
    expect(agg.mappings).toBe(1);      // only cheese has an alias
    expect(agg.ledgerSales).toBe(1);   // one Cheese Squishy sale
  });

  it("INVARIANT: archiveItems leaves buildLedgerReport unchanged", () => {
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""`;
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    saveLedger(db, parseLedger(csv));
    const before = JSON.stringify(buildLedgerReport(db));
    archiveItems(db, [cheese]);
    expect(JSON.stringify(buildLedgerReport(db))).toBe(before);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- "tests/lib/db/inventory"`
Expected: FAIL — `archiveItems`/`deleteItems`/`bulkDeleteImpact` not exported.

- [ ] **Step 3: Implement**

In `src/lib/db/inventory.ts` (the `DeleteImpact` interface and `deleteImpact`, `archiveItem`, `unarchiveItem`, `deleteItem` already exist). Add:

```typescript
export function archiveItems(db: DB, ids: number[]): void {
  const tx = db.transaction((list: number[]) => { for (const id of list) archiveItem(db, id); });
  tx(ids);
}

export function unarchiveItems(db: DB, ids: number[]): void {
  const tx = db.transaction((list: number[]) => { for (const id of list) unarchiveItem(db, id); });
  tx(ids);
}

export function deleteItems(db: DB, ids: number[]): void {
  const tx = db.transaction((list: number[]) => { for (const id of list) deleteItem(db, id); });
  tx(ids);
}

export interface BulkDeleteImpact { items: number; mappings: number; ledgerSales: number; showLineSales: number; brotherTxns: number; }

export function bulkDeleteImpact(db: DB, ids: number[]): BulkDeleteImpact {
  const agg: BulkDeleteImpact = { items: ids.length, mappings: 0, ledgerSales: 0, showLineSales: 0, brotherTxns: 0 };
  for (const id of ids) {
    const i = deleteImpact(db, id);
    agg.mappings += i.mappings;
    agg.ledgerSales += i.ledgerSales;
    agg.showLineSales += i.showLineSales;
    agg.brotherTxns += i.brotherTxns;
  }
  return agg;
}
```

Note: `deleteItem` is itself a `db.transaction(...)`. better-sqlite3 supports nested transactions via SAVEPOINT, so wrapping in an outer `db.transaction` is safe and makes the batch atomic.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- "tests/lib/db/inventory"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): bulk archive/unarchive/delete helpers + aggregate impact"
```

---

### Task 2: Bulk API routes

**Files:**
- Create: `src/app/api/inventory/bulk/route.ts`
- Create: `src/app/api/inventory/bulk-delete-impact/route.ts`

**Interfaces:**
- Consumes: `archiveItems`, `unarchiveItems`, `deleteItems`, `bulkDeleteImpact` (Task 1).
- Produces:
  - `POST /api/inventory/bulk` `{ action: "archive"|"unarchive"|"delete", ids: number[] }` → `{ ok: true }` (400 on bad action or empty/invalid ids).
  - `POST /api/inventory/bulk-delete-impact` `{ ids: number[] }` → `BulkDeleteImpact` JSON.

- [ ] **Step 1: Bulk action route**

Create `src/app/api/inventory/bulk/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { archiveItems, unarchiveItems, deleteItems } from "@/lib/db/inventory";

const ACTIONS = ["archive", "unarchive", "delete"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: NextRequest) {
  const b = await req.json();
  const action = b.action as Action;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "invalid action" }, { status: 400 });
  const ids: unknown = b.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n))) {
    return NextResponse.json({ error: "ids must be a non-empty array of integers" }, { status: 400 });
  }
  const db = await dbForRequest();
  const list = ids as number[];
  if (action === "archive") archiveItems(db, list);
  else if (action === "unarchive") unarchiveItems(db, list);
  else deleteItems(db, list);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Impact route**

Create `src/app/api/inventory/bulk-delete-impact/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { bulkDeleteImpact } from "@/lib/db/inventory";

export async function POST(req: NextRequest) {
  const b = await req.json();
  const ids: unknown = b.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n))) {
    return NextResponse.json({ error: "ids must be a non-empty array of integers" }, { status: 400 });
  }
  return NextResponse.json(bulkDeleteImpact(await dbForRequest(), ids as number[]));
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "inventory/(bulk|bulk-delete-impact)" || echo "routes clean"`
Expected: `routes clean`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/inventory/bulk src/app/api/inventory/bulk-delete-impact
git commit -m "feat(inventory): bulk action + bulk-delete-impact API routes"
```

---

### Task 3: Selection + BulkActionBar in the active table

**Files:**
- Create: `src/components/inventory/BulkActionBar.tsx`
- Create: `src/lib/ui/bulk-delete-message.ts` (pure message builder + test)
- Modify: `src/components/InventoryTable.tsx`
- Test: `tests/lib/ui/bulk-delete-message.test.ts`

**Interfaces:**
- Consumes: `POST /api/inventory/bulk`, `POST /api/inventory/bulk-delete-impact` (Task 2); `BulkDeleteImpact` type (Task 1).
- Produces:
  - `BulkActionBar({ count, actions, onClear })` where `actions: { label: string; variant: "primary"|"danger"; onClick: () => void }[]`.
  - `bulkDeleteMessage(impact: BulkDeleteImpact): string`.

- [ ] **Step 1: Pure delete-message builder + test**

Create `src/lib/ui/bulk-delete-message.ts`:

```typescript
import type { BulkDeleteImpact } from "@/lib/db/inventory";

/** Human-readable confirmation for a bulk delete, spelling out the blast radius.
 *  Mirrors the single-item DeleteItemButton wording, aggregated. */
export function bulkDeleteMessage(impact: BulkDeleteImpact): string {
  const parts: string[] = [];
  if (impact.mappings > 0) {
    const sales = impact.ledgerSales === 1 ? "1 ledger sale" : `${impact.ledgerSales} ledger sales`;
    parts.push(`unmaps ${impact.mappings === 1 ? "1 Whatnot name" : `${impact.mappings} Whatnot names`} (${sales} become unmapped)`);
  }
  if (impact.showLineSales > 0) parts.push(`detaches ${impact.showLineSales} legacy show ${impact.showLineSales === 1 ? "sale" : "sales"}`);
  if (impact.brotherTxns > 0) parts.push(`detaches ${impact.brotherTxns} brother ${impact.brotherTxns === 1 ? "transaction" : "transactions"}`);
  const detail = parts.length ? ` This ${parts.join(" and ")}.` : "";
  const n = impact.items;
  return `Delete ${n} ${n === 1 ? "item" : "items"}?${detail} Sales data is kept — re-add and re-map to restore counts. Cannot be undone.`;
}
```

Create `tests/lib/ui/bulk-delete-message.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { bulkDeleteMessage } from "@/lib/ui/bulk-delete-message";

describe("bulkDeleteMessage", () => {
  it("spells out mappings and sales", () => {
    const msg = bulkDeleteMessage({ items: 3, mappings: 5, ledgerSales: 40, showLineSales: 0, brotherTxns: 0 });
    expect(msg).toContain("Delete 3 items?");
    expect(msg).toContain("unmaps 5 Whatnot names (40 ledger sales become unmapped)");
    expect(msg).toContain("Cannot be undone.");
  });
  it("omits the detail clause when there is no blast radius", () => {
    const msg = bulkDeleteMessage({ items: 1, mappings: 0, ledgerSales: 0, showLineSales: 0, brotherTxns: 0 });
    expect(msg).toBe("Delete 1 item? Sales data is kept — re-add and re-map to restore counts. Cannot be undone.");
  });
});
```

- [ ] **Step 2: Run the message test (fail → pass)**

Run: `npm test -- bulk-delete-message`
Expected: FAIL first (module missing), then PASS after Step 1's implementation exists.

- [ ] **Step 3: BulkActionBar component**

Create `src/components/inventory/BulkActionBar.tsx`:

```tsx
"use client";
import { Button } from "@/components/ui/Button";

export type BulkAction = { label: string; variant: "primary" | "danger"; onClick: () => void };

export function BulkActionBar({ count, actions, onClear }: { count: number; actions: BulkAction[]; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
      <b>{count} selected</b>
      {actions.map((a) => (
        <Button key={a.label} variant={a.variant} onClick={a.onClick} className="px-3 py-1.5 text-sm">{a.label}</Button>
      ))}
      <button onClick={onClear} className="ml-auto text-slate-500 hover:underline">Clear</button>
    </div>
  );
}
```

- [ ] **Step 4: Add selection to `InventoryTable`**

In `src/components/InventoryTable.tsx`:
- Add imports:
  ```tsx
  import { BulkActionBar, type BulkAction } from "@/components/inventory/BulkActionBar";
  import { bulkDeleteMessage } from "@/lib/ui/bulk-delete-message";
  ```
- Add selection state inside the component (near the other `useState`s):
  ```tsx
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clear = () => setSelected(new Set());
  const allVisibleSelected = sorted.length > 0 && sorted.every((i) => selected.has(i.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(sorted.map((i) => i.id)));
  ```
  (`sorted` is the already-computed filtered+sorted list.)
- Add the bulk-op handlers:
  ```tsx
  async function runBulk(action: "archive" | "delete") {
    const ids = [...selected];
    if (action === "delete") {
      const res = await fetch("/api/inventory/bulk-delete-impact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!res.ok) return;
      const impact = await res.json();
      if (!confirm(bulkDeleteMessage(impact))) return;
    }
    const r = await fetch("/api/inventory/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids }) });
    if (r.ok) { clear(); router.refresh(); }
  }
  const bulkActions: BulkAction[] = [
    { label: "Archive", variant: "primary", onClick: () => runBulk("archive") },
    { label: "Delete", variant: "danger", onClick: () => runBulk("delete") },
  ];
  ```
  This component needs `router` — add `const router = useRouter();` and `import { useRouter } from "next/navigation";` if not present.
- Render `<BulkActionBar count={selected.size} actions={bulkActions} onClear={clear} />` just above the search/filter row (inside the top `<div className="space-y-3">`).
- Add a header checkbox as the FIRST `<th>` in the `DataTable` head:
  ```tsx
  <th className="px-3 py-2 w-8"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all" /></th>
  ```
- Add a body checkbox as the FIRST `<td>` in each row, and highlight selected rows (change the `<tr>` className):
  ```tsx
  <tr key={i.id} className={`border-t border-line ${selected.has(i.id) ? "bg-brand-50" : ""}`}>
    <td className="px-3 py-2"><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.name}`} /></td>
    {/* ...existing cells... */}
  ```
- Update the empty-state row's `colSpan` from `COLUMNS.length + 1` to `COLUMNS.length + 2` (checkbox column added).

- [ ] **Step 5: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "InventoryTable|BulkActionBar|bulk-delete-message" | grep -v "giveaway-items.test.ts" || echo "clean"` then `npm run build 2>&1 | tail -3`
Expected: `clean`; build completes.

- [ ] **Step 6: Commit**

```bash
git add src/components/inventory/BulkActionBar.tsx src/lib/ui/bulk-delete-message.ts tests/lib/ui/bulk-delete-message.test.ts src/components/InventoryTable.tsx
git commit -m "feat(inventory): row selection + bulk archive/delete bar on active table"
```

---

### Task 4: Archived table with selection (Unarchive + Delete)

**Files:**
- Create: `src/components/inventory/ArchivedTable.tsx`
- Modify: `src/app/inventory/page.tsx` (render `ArchivedTable` in place of the inline `<details>` markup)

**Interfaces:**
- Consumes: `BulkActionBar`, `bulkDeleteMessage`, the bulk API routes.
- Produces: `ArchivedTable({ rows })` where `rows: { id: number; name: string; remaining: number; archivedAt: string | null }[]`.

- [ ] **Step 1: ArchivedTable component**

Create `src/components/inventory/ArchivedTable.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BulkActionBar, type BulkAction } from "@/components/inventory/BulkActionBar";
import { bulkDeleteMessage } from "@/lib/ui/bulk-delete-message";

type Row = { id: number; name: string; remaining: number; archivedAt: string | null };

export function ArchivedTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clear = () => setSelected(new Set());
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  async function runBulk(action: "unarchive" | "delete") {
    const ids = [...selected];
    if (action === "delete") {
      const res = await fetch("/api/inventory/bulk-delete-impact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!res.ok) return;
      if (!confirm(bulkDeleteMessage(await res.json()))) return;
    }
    const r = await fetch("/api/inventory/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids }) });
    if (r.ok) { clear(); router.refresh(); }
  }
  const actions: BulkAction[] = [
    { label: "Unarchive", variant: "primary", onClick: () => runBulk("unarchive") },
    { label: "Delete", variant: "danger", onClick: () => runBulk("delete") },
  ];

  return (
    <details className="rounded-2xl border border-line bg-white shadow-soft">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-500">Archived ({rows.length})</summary>
      <div className="space-y-2 border-t border-line p-3">
        <BulkActionBar count={selected.size} actions={actions} onClear={clear} />
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all archived" /></th>
              <th className="px-2 py-1">Item</th><th className="px-2 py-1 text-right">Remaining</th><th className="px-2 py-1">Archived</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-line ${selected.has(r.id) ? "bg-brand-50" : ""}`}>
                <td className="px-2 py-2"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
                <td className="px-2 py-2"><Link href={`/inventory/${r.id}`} className="font-medium text-slate-600 hover:underline">{r.name}</Link></td>
                <td className="px-2 py-2 text-right text-slate-400">{r.remaining}</td>
                <td className="px-2 py-2 text-xs text-slate-400">{r.archivedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
```

- [ ] **Step 2: Wire into the inventory page**

In `src/app/inventory/page.tsx`:
- Add `import { ArchivedTable } from "@/components/inventory/ArchivedTable";`
- Replace the existing inline archived `<details>...</details>` block (the one rendered `{archived.length > 0 && (...)}`) with:
  ```tsx
  {archived.length > 0 && (
    <ArchivedTable rows={archived.map((i) => ({ id: i.id, name: i.name, remaining: i.remaining, archivedAt: i.archivedAt }))} />
  )}
  ```
- Remove the now-unused `Link` import from `page.tsx` ONLY if it is no longer referenced elsewhere in the file (check first; the mapping/unmapped-banner may still use it — if so, leave it).

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "ArchivedTable|inventory/page" | grep -v "giveaway-items.test.ts" || echo "clean"` then `npm run build 2>&1 | tail -3`
Expected: `clean`; build completes.

- [ ] **Step 4: Commit**

```bash
git add src/components/inventory/ArchivedTable.tsx src/app/inventory/page.tsx
git commit -m "feat(inventory): archived table with bulk unarchive/delete"
```

---

### Task 5: Full-suite verification

- [ ] **Step 1: Suite + build**

Run: `npm test && npm run build 2>&1 | grep -E "/api/inventory/bulk"`
Expected: all Vitest tests PASS (incl. Task 1 batch helpers + invariant guard + the `bulkDeleteMessage` unit test + the backup drift-guard, which is unaffected — no schema change). Build lists `/api/inventory/bulk` and `/api/inventory/bulk-delete-impact`.

- [ ] **Step 2: Manual smoke (live dev)**

Run `npm run dev`, log in, open `/inventory`:
- Check two rows → bar shows "2 selected". Click **Archive** → both move to Archived; selection clears.
- In Archived, select all → **Unarchive** → they return.
- Select an item WITH sales → **Delete** → the confirm spells out the aggregate impact ("unmaps N Whatnot names…"); cancel → nothing happens; confirm → items gone, and `/report` profit unchanged.
- "Select all" header box selects only the currently searched/filtered rows.
Stop the dev server.

---

## Self-Review

**Spec coverage:**
- Bulk Archive/Unarchive + Delete only → Tasks 1–4. ✓
- Checkbox per row + header select-all over filtered rows → Task 3 (`toggleAll` over `sorted`), Task 4 (over `rows`). ✓
- Bulk action bar, per-table, appears at ≥1 selected → `BulkActionBar` (returns null at 0), used in both tables. ✓
- Active → Archive+Delete; Archived → Unarchive+Delete → Task 3 / Task 4 action lists. ✓
- Aggregate impact confirmation before bulk delete; archive/unarchive no confirm → `runBulk` (confirm only on delete). ✓
- Transactional batch helpers on existing single-item fns → Task 1. ✓
- API `bulk` + `bulk-delete-impact` with validation → Task 2. ✓
- Invariant (archive doesn't move money) → Task 1 invariant guard test. ✓
- Native confirm (no bespoke modal) → Task 3/4 use `confirm(bulkDeleteMessage(...))`. ✓ (deliberate simplification, noted in Global Constraints)
- No schema change; backup unaffected → confirmed in Task 5. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `BulkDeleteImpact` (Task 1) consumed by `bulkDeleteMessage` (Task 3) and the impact route (Task 2); `BulkAction`/`BulkActionBar` (Task 3) reused in Task 4; `archiveItems`/`unarchiveItems`/`deleteItems` signatures match the route calls (Task 2). `sorted` (existing in InventoryTable) drives select-all. ✓
