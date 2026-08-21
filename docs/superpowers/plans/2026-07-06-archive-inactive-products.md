# Archive / Inactive Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user soft-archive inventory items they no longer carry — hiding them from the active list, count page, and new-mapping picker — while keeping all data and history, and never touching profit/COGS math.

**Architecture:** A nullable `archived_at` column on `inventory_items` (NULL = active). Pure db helpers `archiveItem`/`unarchiveItem` and an `archivedAt` field on `ItemRow`. The inventory page splits items into active (main table) and archived (collapsible section); the count page and alias-mapping picker filter to active. A small client `ArchiveButton` POSTs to a new route then refreshes. No calc/report code changes — the archived flag is never read by money math.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest, Tailwind.

## Global Constraints

- **Core invariant:** archiving is organizational only. `qtyRemaining`, `qtySold*`, COGS, and `buildLedgerReport` must be identical before and after archiving. No calc/report/ledger code may read `archived_at`.
- Every db function takes a `db: DB` handle first (multi-workspace: never call `getDb` in business logic).
- Server components call `await dbForRequest()`; API routes call `await dbForRequest()`.
- Route params are async: `{ params }: { params: Promise<{ id: string }> }`, read via `await params`.
- Adding a column to an existing table needs a guarded `ALTER TABLE ... ADD COLUMN` in `migrate()` (SQLite has no `ADD COLUMN IF NOT EXISTS`) AND the column in `SCHEMA` for fresh DBs.
- `archived_at` stores today's date as `new Date().toISOString().slice(0, 10)` (matches the `adjusted_on` convention). Backup captures `inventory_items` columns via PRAGMA, so it round-trips with no `TABLES` change.
- Follow existing file style (semicolons, `@/` alias, small focused modules).
- The only tolerated pre-existing `tsc` error is `tests/lib/db/giveaway-items.test.ts` — ignore it; changed files must be clean.

---

### Task 1: `archived_at` column + archive/unarchive db helpers

**Files:**
- Modify: `src/lib/db/schema.ts` (`inventory_items` CREATE, ~line 9-17 — add `archived_at`)
- Modify: `src/lib/db/connection.ts` (`migrate()` — guarded ALTER, placed with the other `inventory_items` column guards ~line 20-27)
- Modify: `src/lib/db/inventory.ts` (`ItemRow`, `listItems`, new `archiveItem`/`unarchiveItem`)
- Modify: `tests/lib/db/inventory.test.ts` (new cases + invariant guard)

**Interfaces:**
- Produces:
  - `ItemRow` gains `archivedAt: string | null`
  - `archiveItem(db: DB, id: number): void`
  - `unarchiveItem(db: DB, id: number): void`
  - `listItems(db)` now returns `archivedAt`

- [ ] **Step 1: Add the column to schema + migration**

In `src/lib/db/schema.ts`, add `archived_at` to the `inventory_items` table so it reads:

```sql
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit_cost_cents INTEGER NOT NULL,
  qty_purchased INTEGER NOT NULL DEFAULT 0,
  qty_samples INTEGER NOT NULL DEFAULT 0,
  qty_adjustment INTEGER NOT NULL DEFAULT 0,
  lot_id INTEGER REFERENCES lots(id),
  archived_at TEXT
);
```

In `src/lib/db/connection.ts` `migrate()`, alongside the existing `inventory_items` column guards (where `qty_samples`/`qty_adjustment` are checked, ~line 20-27), add — reusing the already-computed `cols` array:

```typescript
  if (!cols.includes("archived_at")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN archived_at TEXT");
  }
```

- [ ] **Step 2: Write the failing tests**

Add to `tests/lib/db/inventory.test.ts` (add imports as needed: `archiveItem, unarchiveItem, listItems, qtyRemaining, qtySold` from `@/lib/db/inventory`; `setAlias` from `@/lib/db/aliases`; `parseLedger` from `@/lib/csv/ledger`; `saveLedger` from `@/lib/db/ledger`; `buildLedgerReport` from `@/lib/calc/ledger-report`):

```typescript
describe("archive", () => {
  it("archiveItem sets archived_at, unarchiveItem clears it; listItems surfaces it", () => {
    const id = insertItem(db, { name: "Retired", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    expect(listItems(db).find((i) => i.id === id)!.archivedAt).toBeNull();
    archiveItem(db, id);
    const archived = listItems(db).find((i) => i.id === id)!;
    expect(archived.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    unarchiveItem(db, id);
    expect(listItems(db).find((i) => i.id === id)!.archivedAt).toBeNull();
  });

  it("INVARIANT: archiving does not change qtyRemaining, qtySold, or the ledger report", () => {
    const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""`;
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    saveLedger(db, parseLedger(CSV));

    const remBefore = qtyRemaining(db, cheese);
    const soldBefore = qtySold(db, cheese);
    const repBefore = JSON.stringify(buildLedgerReport(db));

    archiveItem(db, cheese);

    expect(qtyRemaining(db, cheese)).toBe(remBefore);
    expect(qtySold(db, cheese)).toBe(soldBefore);
    expect(JSON.stringify(buildLedgerReport(db))).toBe(repBefore);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- "tests/lib/db/inventory"`
Expected: FAIL — `archiveItem`/`unarchiveItem` not exported; `archivedAt` missing from `ItemRow`.

- [ ] **Step 4: Implement**

In `src/lib/db/inventory.ts`:

Update `ItemRow`:
```typescript
export interface ItemRow { id: number; name: string; unitCostCents: number; qtyPurchased: number; lotId: number | null; archivedAt: string | null; }
```

Update `listItems` SELECT to include the column:
```typescript
export function listItems(db: DB): ItemRow[] {
  return db.prepare("SELECT id, name, unit_cost_cents as unitCostCents, qty_purchased as qtyPurchased, lot_id as lotId, archived_at as archivedAt FROM inventory_items ORDER BY name").all() as ItemRow[];
}
```

Add the helpers (near `renameItem`):
```typescript
export function archiveItem(db: DB, id: number): void {
  db.prepare("UPDATE inventory_items SET archived_at = ? WHERE id = ?").run(new Date().toISOString().slice(0, 10), id);
}

export function unarchiveItem(db: DB, id: number): void {
  db.prepare("UPDATE inventory_items SET archived_at = NULL WHERE id = ?").run(id);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- "tests/lib/db/inventory"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): archived_at column + archive/unarchive helpers"
```

---

### Task 2: Archive API route

**Files:**
- Create: `src/app/api/inventory/[id]/archive/route.ts`

**Interfaces:**
- Consumes: `archiveItem`, `unarchiveItem` (Task 1).
- Produces: `POST /api/inventory/:id/archive` body `{ archived: boolean }` → `{ ok: true }` (400 if `archived` is not a boolean).

- [ ] **Step 1: Write the route**

Create `src/app/api/inventory/[id]/archive/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { archiveItem, unarchiveItem } from "@/lib/db/inventory";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json();
  if (typeof b.archived !== "boolean") return NextResponse.json({ error: "archived must be a boolean" }, { status: 400 });
  const db = await dbForRequest();
  if (b.archived) archiveItem(db, id); else unarchiveItem(db, id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "inventory/\[id\]/archive" || echo "route clean"`
Expected: `route clean`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/inventory/[id]/archive"
git commit -m "feat(inventory): archive/unarchive API route"
```

---

### Task 3: `ArchiveButton` + active-row action in `InventoryTable`

**Files:**
- Create: `src/components/inventory/ArchiveButton.tsx`
- Modify: `src/components/InventoryTable.tsx` (add the action to each active row)

**Interfaces:**
- Consumes: `POST /api/inventory/:id/archive` (Task 2).
- Produces: `<ArchiveButton itemId={number} archived={boolean} nudge?={boolean} />` — posts the OPPOSITE of `archived`, then `router.refresh()`. Label: `archived ? "Unarchive" : (nudge ? "Archive?" : "Archive")`; when `nudge` and not archived, styled to stand out (amber).

- [ ] **Step 1: ArchiveButton**

Create `src/components/inventory/ArchiveButton.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ArchiveButton({ itemId, archived, nudge = false }: { itemId: number; archived: boolean; nudge?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = archived ? "Unarchive" : nudge ? "Archive?" : "Archive";
  const cls = archived
    ? "text-sm font-medium text-emerald-700 hover:underline"
    : nudge
      ? "text-sm font-medium text-amber-700 hover:underline"
      : "text-sm font-medium text-slate-500 hover:underline";
  async function go() {
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory/${itemId}/archive`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  }
  return <button onClick={go} disabled={busy} className={cls}>{label}</button>;
}
```

- [ ] **Step 2: Add the action to active rows**

In `src/components/InventoryTable.tsx`:
- Add the import: `import { ArchiveButton } from "@/components/inventory/ArchiveButton";`
- In the actions cell (the last `<td>` that currently holds the Edit button, ~line 91-93), add the archive action next to Edit:
  ```tsx
  <td className="px-3 py-2 text-right">
    <div className="flex items-center justify-end gap-3">
      <button onClick={() => setEditing(i)} className="text-sm font-medium text-emerald-700 hover:underline">Edit</button>
      <ArchiveButton itemId={i.id} archived={false} nudge={i.remaining <= 0} />
    </div>
  </td>
  ```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "ArchiveButton|InventoryTable" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add src/components/inventory/ArchiveButton.tsx src/components/InventoryTable.tsx
git commit -m "feat(inventory): ArchiveButton + archive action on active rows"
```

---

### Task 4: Split active/archived on the inventory page; filter mapping picker + count page

**Files:**
- Modify: `src/app/inventory/page.tsx` (split items; collapsible Archived section; pass active-only to `InventoryTable` and `InventoryForms`)
- Modify: `src/app/inventory/count/page.tsx` (filter to active)

**Interfaces:**
- Consumes: `ItemRow.archivedAt` (Task 1), `ArchiveButton` (Task 3).

- [ ] **Step 1: Split the inventory page**

In `src/app/inventory/page.tsx`:
- Add imports: `import { ArchiveButton } from "@/components/inventory/ArchiveButton";` and `import Link from "next/link";` (if not already imported).
- After building `items` (the `listItems(db).map(...)` with `sold`/`remaining`), split it:
  ```tsx
  const active = items.filter((i) => i.archivedAt == null);
  const archived = items.filter((i) => i.archivedAt != null);
  ```
- Change the `InventoryTable` call to pass `active` instead of `items` (map `active` the same way it currently maps `items`).
- Change the `InventoryForms` call to pass `active` instead of `items`:
  ```tsx
  <InventoryForms items={active.map((i) => ({ id: i.id, name: i.name }))} seenNames={seen} />
  ```
- Add a collapsible Archived section immediately AFTER the `InventoryTable` block:
  ```tsx
  {archived.length > 0 && (
    <details className="rounded-2xl border border-line bg-white shadow-soft">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-500">Archived ({archived.length})</summary>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-left text-sm">
          <tbody>
            {archived.map((i) => (
              <tr key={i.id} className="border-t border-line first:border-0">
                <td className="px-5 py-2">
                  <Link href={`/inventory/${i.id}`} className="font-medium text-slate-600 hover:underline">{i.name}</Link>
                </td>
                <td className="px-3 py-2 text-slate-400">Remaining {i.remaining}</td>
                <td className="px-3 py-2 text-xs text-slate-400">archived {i.archivedAt}</td>
                <td className="px-5 py-2 text-right"><ArchiveButton itemId={i.id} archived={true} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )}
  ```
- Note: the stat cards at the top (`stock`, `spend`) currently derive from `items`. Leave them on the full `items` set OR switch to `active` — per the spec, archived items are "out of the way" for day-to-day, so change `inStockSummary(items)` to `inStockSummary(active)` and the `itemCosts`/`spend` to use `active`, so the summary reflects only carried stock. (Archived items are typically 0-remaining anyway.)

- [ ] **Step 2: Filter the count page**

In `src/app/inventory/count/page.tsx`, change the item list to exclude archived:
```tsx
const items = listItems(db).filter((i) => i.archivedAt == null).map((i) => ({ id: i.id, name: i.name, expected: qtyRemaining(db, i.id) }));
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "inventory/page|inventory/count" | grep -v "giveaway-items.test.ts" || echo "clean"` then `npm run build 2>&1 | tail -3`
Expected: `clean`; build completes.

- [ ] **Step 4: Commit**

```bash
git add src/app/inventory/page.tsx src/app/inventory/count/page.tsx
git commit -m "feat(inventory): active/archived split on list; exclude archived from count + mapping"
```

---

### Task 5: Archive control on the item detail page

**Files:**
- Modify: `src/app/inventory/[id]/page.tsx`

**Interfaces:**
- Consumes: `ArchiveButton` (Task 3); the item's `archived_at` (read here directly).

- [ ] **Step 1: Read archived state + render the control**

In `src/app/inventory/[id]/page.tsx`:
- Add `archived_at as archivedAt` to the item SELECT and widen the row type:
  ```tsx
  const item = db.prepare(
    "SELECT id, name, unit_cost_cents as unitCostCents, qty_purchased as qtyPurchased, archived_at as archivedAt FROM inventory_items WHERE id = ?"
  ).get(itemId) as { id: number; name: string; unitCostCents: number; qtyPurchased: number; archivedAt: string | null } | undefined;
  ```
- Add the import: `import { ArchiveButton } from "@/components/inventory/ArchiveButton";`
- In the `PageHeader` `action` (currently just the "← Inventory" link), include the archive toggle beside it, and show an archived note in the subtitle:
  ```tsx
  <PageHeader title={item.name}
    subtitle={item.archivedAt ? `Archived ${item.archivedAt} · sales history still counts` : "Sales and Whatnot name mappings for this item"}
    action={
      <div className="flex items-center gap-4">
        <ArchiveButton itemId={item.id} archived={item.archivedAt != null} />
        <Link className="text-sm text-emerald-700 hover:underline" href="/inventory">← Inventory</Link>
      </div>
    } />
  ```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "inventory/\[id\]/page" | grep -v "giveaway-items.test.ts" || echo "clean"` then `npm run build 2>&1 | tail -3`
Expected: `clean`; build completes.

- [ ] **Step 3: Commit**

```bash
git add "src/app/inventory/[id]/page.tsx"
git commit -m "feat(inventory): archive/unarchive control on item detail page"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1: Suite + build**

Run: `npm test && npm run build 2>&1 | grep -E "/api/inventory/\[id\]/archive|/inventory"`
Expected: all Vitest tests PASS (including the invariant guard from Task 1 and the backup drift-guard — `archived_at` is inside `inventory_items`, already covered). Build lists the archive route.

- [ ] **Step 2: Manual smoke (live dev)**

Run `npm run dev`, log in. On `/inventory`: an active item shows an "Archive" action; a 0-remaining item shows the amber "Archive?" nudge. Click Archive → the item moves under "Archived (N)" and disappears from the main table, the count page (`/inventory/count`), and the mapping picker. Open the archived item → its page loads with the "Archived …" subtitle and an "Unarchive" button; click it → it returns to active. Confirm `/report` totals are unchanged throughout. Stop the dev server.

---

## Self-Review

**Spec coverage:**
- Manual archive/unarchive of any item → Task 1 (helpers) + Task 3 (row action) + Task 5 (detail page). ✓
- Suggested inline nudge on 0-remaining active items → Task 3 (`nudge={i.remaining <= 0}` → amber "Archive?"). ✓
- Hidden from active list, shown under collapsible "Archived (N)" → Task 4. ✓
- Hidden from count page → Task 4 Step 2. ✓
- Reachable detail page with Unarchive → Task 5. ✓
- Report/profit unchanged → Global Constraint + Task 1 invariant guard test (buildLedgerReport byte-identical). ✓
- Not offered as a new mapping target (existing mappings intact) → Task 4 Step 1 (InventoryForms gets `active` only). ✓
- Data model `archived_at` nullable + guarded migration + fresh SCHEMA + backup round-trip → Task 1 + Global Constraints. ✓
- API validates boolean → Task 2. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `ItemRow.archivedAt` (Task 1) consumed by the page split (Task 4) and via `ArchiveButton` props (Task 3, 4, 5); `ArchiveButton` prop shape (`itemId`, `archived`, `nudge?`) used identically everywhere; the detail-page item row type widened to include `archivedAt` where read. ✓
