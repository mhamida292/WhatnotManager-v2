# Expenses Page Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edit/delete, sortable list, a category breakdown + month filter, and a per-expense itemized detail page to `/expenses`; drop the "negative = offset" convention.

**Architecture:** Business logic stays in `src/lib/db/` pure functions taking a `db` handle (Vitest-tested). New `expense_items` table (one expense → many optional line items). Next.js App Router server components read the db directly via `dbForRequest()`; interactive bits are client components that POST/PATCH to `/api/expenses/*` then `location.reload()`. Reuses existing UI primitives (`PageHeader`, `Stat`, `Card`, `DataTable`, `Money`, `Button`, `INPUT_CLASS`).

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest, Tailwind.

## Global Constraints

- Money is stored as **integer cents** everywhere. Parse dollars with `Math.round(Number(x) * 100)`.
- Every db function takes a `db: DB` handle as its first arg (multi-workspace: never call `getDb` inside business logic).
- Server components call `await dbForRequest()`; API routes call `await dbForRequest()`.
- New tables go in `src/lib/db/schema.ts` `SCHEMA` (exec'd on every connection, so existing workspaces pick them up — no separate migration needed for a brand-new table).
- Route params are async: `{ params }: { params: Promise<{ id: string }> }`, read via `await params`.
- Follow existing file style (semicolons, `@/` import alias, small focused modules).
- Foreign keys are ON; `ON DELETE CASCADE` is honored.

---

### Task 1: `expense_items` table + item db module

**Files:**
- Modify: `src/lib/db/schema.ts` (add `expense_items` table after the `expenses` table block, ~line 109)
- Create: `src/lib/db/expense-items.ts`
- Create: `tests/lib/db/expense-items.test.ts`

**Interfaces:**
- Produces:
  - `interface ExpenseItemRow { id: number; expenseId: number; name: string; qty: number | null; unitCents: number | null; sortOrder: number }`
  - `listExpenseItems(db: DB, expenseId: number): ExpenseItemRow[]`
  - `replaceExpenseItems(db: DB, expenseId: number, items: { name: string; qty: number | null; unitCents: number | null }[]): void` — deletes existing rows for the expense and inserts the given ones in order (sort_order = index). Rows whose trimmed `name` is empty are skipped.

- [ ] **Step 1: Add the table to `SCHEMA`**

In `src/lib/db/schema.ts`, immediately after the `expenses` table (the block ending at its closing `);`, before `CREATE TABLE IF NOT EXISTS app_settings`), add:

```sql
CREATE TABLE IF NOT EXISTS expense_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty REAL,
  unit_cents INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/db/expense-items.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertExpense } from "@/lib/db/expenses";
import { listExpenseItems, replaceExpenseItems } from "@/lib/db/expense-items";

let db: DB;
let expenseId: number;
beforeEach(() => {
  db = createDb(":memory:");
  expenseId = insertExpense(db, { description: "Shipping materials", type: "one_time", category: "Shipping", amountCents: 8420 });
});

describe("expense items", () => {
  it("replaces items, preserving order and optional qty/price", () => {
    replaceExpenseItems(db, expenseId, [
      { name: "Bubble wrap", qty: 2, unitCents: 1100 },
      { name: "Misc tape", qty: null, unitCents: null },
    ]);
    const rows = listExpenseItems(db, expenseId);
    expect(rows.map((r) => r.name)).toEqual(["Bubble wrap", "Misc tape"]);
    expect(rows[0]).toMatchObject({ qty: 2, unitCents: 1100, sortOrder: 0 });
    expect(rows[1]).toMatchObject({ qty: null, unitCents: null, sortOrder: 1 });
  });

  it("skips rows with blank names and overwrites on re-save", () => {
    replaceExpenseItems(db, expenseId, [{ name: "First", qty: null, unitCents: null }]);
    replaceExpenseItems(db, expenseId, [
      { name: "  ", qty: 1, unitCents: 500 },
      { name: "Kept", qty: null, unitCents: null },
    ]);
    const rows = listExpenseItems(db, expenseId);
    expect(rows.map((r) => r.name)).toEqual(["Kept"]);
  });

  it("cascades on expense delete via foreign key", () => {
    replaceExpenseItems(db, expenseId, [{ name: "X", qty: null, unitCents: null }]);
    db.prepare("DELETE FROM expenses WHERE id = ?").run(expenseId);
    expect(listExpenseItems(db, expenseId)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- expense-items`
Expected: FAIL — `Cannot find module '@/lib/db/expense-items'`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/db/expense-items.ts`:

```typescript
import type { DB } from "./connection";

export interface ExpenseItemRow {
  id: number; expenseId: number; name: string;
  qty: number | null; unitCents: number | null; sortOrder: number;
}

export function listExpenseItems(db: DB, expenseId: number): ExpenseItemRow[] {
  return db.prepare(
    `SELECT id, expense_id AS expenseId, name, qty, unit_cents AS unitCents, sort_order AS sortOrder
     FROM expense_items WHERE expense_id = ? ORDER BY sort_order, id`
  ).all(expenseId) as ExpenseItemRow[];
}

export function replaceExpenseItems(
  db: DB, expenseId: number,
  items: { name: string; qty: number | null; unitCents: number | null }[],
): void {
  const clean = items.filter((i) => i.name.trim() !== "");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM expense_items WHERE expense_id = ?").run(expenseId);
    const insert = db.prepare(
      "INSERT INTO expense_items (expense_id, name, qty, unit_cents, sort_order) VALUES (?,?,?,?,?)"
    );
    clean.forEach((i, idx) =>
      insert.run(expenseId, i.name.trim(), i.qty ?? null, i.unitCents ?? null, idx));
  });
  tx();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- expense-items`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/expense-items.ts tests/lib/db/expense-items.test.ts
git commit -m "feat(expenses): expense_items table + replace/list db module"
```

---

### Task 2: expense get / update / delete + category breakdown + range totals

**Files:**
- Modify: `src/lib/db/expenses.ts`
- Modify: `tests/lib/db/expenses.test.ts` (add cases)

**Interfaces:**
- Consumes: `ExpenseRow` (existing).
- Produces:
  - `getExpense(db: DB, id: number): ExpenseRow | null`
  - `updateExpense(db: DB, id: number, e: { description: string; type: "one_time" | "recurring"; category: string | null; amountCents: number; incurredOn: string | null }): void`
  - `deleteExpense(db: DB, id: number): void`
  - `type DateRange = { from?: string; to?: string }`
  - `totalExpensesCents(db: DB, range?: DateRange): number` — no arg sums all (unchanged); with a range, sums only rows whose `incurred_on` is within `[from, to]` inclusive (rows with null `incurred_on` are excluded when a range is given).
  - `expensesByCategory(db: DB, range?: DateRange): { category: string; totalCents: number }[]` — grouped, null category rendered as `"Uncategorized"`, ordered by total descending.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/db/expenses.test.ts` (add the new imports at top: `getExpense, updateExpense, deleteExpense, expensesByCategory`):

```typescript
import { insertExpense, listExpenses, totalExpensesCents,
  getExpense, updateExpense, deleteExpense, expensesByCategory } from "@/lib/db/expenses";

describe("expense edit/delete", () => {
  it("updates and deletes an expense", () => {
    const id = insertExpense(db, { description: "Ring light", type: "one_time", category: "Equipment", amountCents: 7500 });
    updateExpense(db, id, { description: "Ring light XL", type: "one_time", category: "Equipment", amountCents: 8000, incurredOn: "2026-07-01" });
    expect(getExpense(db, id)).toMatchObject({ description: "Ring light XL", amountCents: 8000, incurredOn: "2026-07-01" });
    deleteExpense(db, id);
    expect(getExpense(db, id)).toBeNull();
  });
});

describe("insight queries", () => {
  beforeEach(() => {
    insertExpense(db, { description: "A", type: "one_time", category: "Shipping", amountCents: 1000, incurredOn: "2026-07-02" });
    insertExpense(db, { description: "B", type: "one_time", category: "Shipping", amountCents: 2000, incurredOn: "2026-07-20" });
    insertExpense(db, { description: "C", type: "one_time", category: "Displays", amountCents: 5000, incurredOn: "2026-06-15" });
    insertExpense(db, { description: "D", type: "one_time", category: null, amountCents: 300, incurredOn: null });
  });
  it("totals a date range inclusively, excluding null dates", () => {
    expect(totalExpensesCents(db, { from: "2026-07-01", to: "2026-07-31" })).toBe(3000);
  });
  it("totals everything with no range (including null dates)", () => {
    expect(totalExpensesCents(db)).toBe(8300);
  });
  it("breaks down by category, null => Uncategorized, desc by total", () => {
    const rows = expensesByCategory(db);
    expect(rows[0]).toEqual({ category: "Shipping", totalCents: 3000 });
    expect(rows.find((r) => r.category === "Uncategorized")).toEqual({ category: "Uncategorized", totalCents: 300 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- expenses`
Expected: FAIL — `getExpense`/`updateExpense`/etc. not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/db/expenses.ts`, add below the existing functions:

```typescript
export function getExpense(db: DB, id: number): ExpenseRow | null {
  const r = db.prepare(`SELECT id, description, type, category, amount_cents as amountCents,
    incurred_on as incurredOn FROM expenses WHERE id = ?`).get(id) as ExpenseRow | undefined;
  return r ?? null;
}

export function updateExpense(db: DB, id: number, e: {
  description: string; type: "one_time" | "recurring";
  category: string | null; amountCents: number; incurredOn: string | null;
}): void {
  db.prepare(`UPDATE expenses SET description=?, type=?, category=?, amount_cents=?, incurred_on=?
    WHERE id=?`).run(e.description, e.type, e.category ?? null, e.amountCents, e.incurredOn ?? null, id);
}

export function deleteExpense(db: DB, id: number): void {
  db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
}

export type DateRange = { from?: string; to?: string };

function rangeClause(range?: DateRange): { sql: string; args: string[] } {
  if (!range || (!range.from && !range.to)) return { sql: "", args: [] };
  const parts: string[] = ["incurred_on IS NOT NULL"];
  const args: string[] = [];
  if (range.from) { parts.push("incurred_on >= ?"); args.push(range.from); }
  if (range.to) { parts.push("incurred_on <= ?"); args.push(range.to); }
  return { sql: " WHERE " + parts.join(" AND "), args };
}
```

Then **replace** the existing `totalExpensesCents` with a range-aware version:

```typescript
export function totalExpensesCents(db: DB, range?: DateRange): number {
  const { sql, args } = rangeClause(range);
  const r = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) as t FROM expenses${sql}`).get(...args) as { t: number };
  return Number(r.t);
}

export function expensesByCategory(db: DB, range?: DateRange): { category: string; totalCents: number }[] {
  const { sql, args } = rangeClause(range);
  const rows = db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(category),''),'Uncategorized') AS category,
       COALESCE(SUM(amount_cents),0) AS totalCents
     FROM expenses${sql} GROUP BY category ORDER BY totalCents DESC`
  ).all(...args) as { category: string; totalCents: number }[];
  return rows.map((r) => ({ category: r.category, totalCents: Number(r.totalCents) }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- expenses`
Expected: PASS (existing offset test still green — `totalExpensesCents(db)` unchanged behavior — plus new cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/expenses.ts tests/lib/db/expenses.test.ts
git commit -m "feat(expenses): get/update/delete + category breakdown + range totals"
```

---

### Task 3: API routes for edit/delete + items

**Files:**
- Create: `src/app/api/expenses/[id]/route.ts` (PATCH, DELETE)
- Create: `src/app/api/expenses/[id]/items/route.ts` (PUT)

**Interfaces:**
- Consumes: `getExpense`, `updateExpense`, `deleteExpense` (Task 2); `replaceExpenseItems` (Task 1).
- Produces: HTTP endpoints
  - `PATCH /api/expenses/:id` body `{ description, type, category, amount (dollars string|number), incurredOn }` → `{ ok: true }`
  - `DELETE /api/expenses/:id` → `{ ok: true }`
  - `PUT /api/expenses/:id/items` body `{ items: { name, qty, unit (dollars string|number|null) }[] }` → `{ ok: true }`

- [ ] **Step 1: Write `[id]/route.ts`**

Create `src/app/api/expenses/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { updateExpense, deleteExpense, getExpense } from "@/lib/db/expenses";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json();
  const db = await dbForRequest();
  if (!getExpense(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const amountCents = Math.round(Number(b.amount) * 100);
  if (!Number.isFinite(amountCents)) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  if (typeof b.description !== "string" || b.description.trim() === "")
    return NextResponse.json({ error: "Description required" }, { status: 400 });
  const type = b.type === "recurring" ? "recurring" : "one_time";
  updateExpense(db, id, {
    description: b.description.trim(), type,
    category: typeof b.category === "string" && b.category.trim() ? b.category.trim() : null,
    amountCents, incurredOn: typeof b.incurredOn === "string" && b.incurredOn ? b.incurredOn : null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  deleteExpense(await dbForRequest(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write `[id]/items/route.ts`**

Create `src/app/api/expenses/[id]/items/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { replaceExpenseItems } from "@/lib/db/expense-items";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json();
  const raw: unknown[] = Array.isArray(b.items) ? b.items : [];
  const items = raw.map((it) => {
    const i = it as { name?: unknown; qty?: unknown; unit?: unknown };
    const qtyNum = i.qty === "" || i.qty == null ? null : Number(i.qty);
    const unitNum = i.unit === "" || i.unit == null ? null : Math.round(Number(i.unit) * 100);
    return {
      name: typeof i.name === "string" ? i.name : "",
      qty: qtyNum != null && Number.isFinite(qtyNum) ? qtyNum : null,
      unitCents: unitNum != null && Number.isFinite(unitNum) ? unitNum : null,
    };
  });
  replaceExpenseItems(await dbForRequest(), id, items);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "expenses/\[id\]" || echo "no errors in new routes"`
Expected: `no errors in new routes`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/expenses/[id]
git commit -m "feat(expenses): API for edit/delete expense + replace items"
```

---

### Task 4: Refresh the expenses list page (filter, breakdown, sortable, edit/delete, row links)

**Files:**
- Modify: `src/app/expenses/page.tsx`
- Create: `src/components/expenses/ExpensesTable.tsx` (client: sortable table + delete)
- Create: `src/components/expenses/MonthFilter.tsx` (client: month/all/custom via URL query)
- Modify: `src/components/ExpenseForm.tsx` (remove offset wording)

**Interfaces:**
- Consumes: `listExpenses`, `totalExpensesCents`, `expensesByCategory`, `DateRange` (Task 2).
- Produces: the page reads `?from=&to=` search params to build a `DateRange`.

- [ ] **Step 1: Month filter helper (pure) + test**

Create `src/lib/ui/expense-range.ts`:

```typescript
import type { DateRange } from "@/lib/db/expenses";

/** Build a DateRange from URL search params. `month=YYYY-MM` expands to that whole
 *  month; explicit from/to override; nothing => undefined (all time). */
export function rangeFromParams(p: { month?: string; from?: string; to?: string }): DateRange | undefined {
  if (p.from || p.to) return { from: p.from, to: p.to };
  if (p.month && /^\d{4}-\d{2}$/.test(p.month)) {
    const [y, m] = p.month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this
    return { from: `${p.month}-01`, to: `${p.month}-${String(last).padStart(2, "0")}` };
  }
  return undefined;
}
```

Create `tests/lib/ui/expense-range.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { rangeFromParams } from "@/lib/ui/expense-range";

describe("rangeFromParams", () => {
  it("expands a month to its full span", () => {
    expect(rangeFromParams({ month: "2026-07" })).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(rangeFromParams({ month: "2026-02" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("returns undefined for no params", () => {
    expect(rangeFromParams({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify pass**

Run: `npm test -- expense-range`
Expected: PASS (after writing the impl above; run before impl to see it fail, then after to pass).

- [ ] **Step 3: MonthFilter client component**

Create `src/components/expenses/MonthFilter.tsx`:

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";

export function MonthFilter() {
  const router = useRouter();
  const params = useSearchParams();
  const month = params.get("month") ?? "";
  const set = (m: string) => router.push(m ? `/expenses?month=${m}` : "/expenses");
  return (
    <div className="flex items-center gap-2 text-sm">
      <input type="month" value={month} onChange={(e) => set(e.target.value)}
        className="rounded-xl border border-line bg-white px-3 py-2 text-sm" />
      {month && <button onClick={() => set("")} className="text-slate-500 hover:underline">All time</button>}
    </div>
  );
}
```

- [ ] **Step 4: ExpensesTable client component (sortable + delete + row link)**

Create `src/components/expenses/ExpensesTable.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { Money } from "@/components/Money";
import { DataTable } from "@/components/ui/DataTable";
import type { ExpenseRow } from "@/lib/db/expenses";

type Key = "incurredOn" | "description" | "type" | "category" | "amountCents";

export function ExpensesTable({ rows }: { rows: ExpenseRow[] }) {
  const [key, setKey] = useState<Key>("incurredOn");
  const [asc, setAsc] = useState(false);
  const sorted = [...rows].sort((a, b) => {
    const av = a[key] ?? "", bv = b[key] ?? "";
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return asc ? cmp : -cmp;
  });
  const toggle = (k: Key) => { if (k === key) setAsc(!asc); else { setKey(k); setAsc(false); } };
  const arrow = (k: Key) => (k === key ? (asc ? " ▲" : " ▼") : "");
  const del = async (id: number) => {
    if (!confirm("Delete this expense?")) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    location.reload();
  };
  const H = ({ k, label, right }: { k: Key; label: string; right?: boolean }) => (
    <th className={`cursor-pointer px-3 py-2 ${right ? "text-right" : ""}`} onClick={() => toggle(k)}>{label}{arrow(k)}</th>
  );
  return (
    <DataTable head={<>
      <H k="incurredOn" label="Date" /><H k="description" label="Description" />
      <H k="type" label="Type" /><H k="category" label="Category" />
      <H k="amountCents" label="Amount" right /><th className="px-3 py-2" />
    </>}>
      {sorted.length === 0 && (
        <tr className="border-t border-line"><td className="px-3 py-4 text-slate-400" colSpan={6}>No expenses yet.</td></tr>
      )}
      {sorted.map((e) => (
        <tr key={e.id} className="border-t border-line hover:bg-slate-50">
          <td className="px-3 py-2 text-slate-500">{e.incurredOn ?? "—"}</td>
          <td className="px-3 py-2">
            <Link href={`/expenses/${e.id}`} className="text-brand-700 hover:underline">{e.description} ›</Link>
          </td>
          <td className="px-3 py-2">{e.type === "recurring" ? "Recurring" : "One-time"}</td>
          <td className="px-3 py-2">{e.category ?? "—"}</td>
          <td className="px-3 py-2 text-right"><Money cents={e.amountCents} /></td>
          <td className="px-3 py-2 text-right">
            <button onClick={() => del(e.id)} className="text-slate-400 hover:text-red-600" title="Delete">🗑</button>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
```

- [ ] **Step 5: Rewrite the page**

Replace `src/app/expenses/page.tsx` with:

```tsx
import { dbForRequest } from "@/lib/auth/request";
import { listExpenses, totalExpensesCents, expensesByCategory } from "@/lib/db/expenses";
import { rangeFromParams } from "@/lib/ui/expense-range";
import { ExpenseForm } from "@/components/ExpenseForm";
import { ExpensesTable } from "@/components/expenses/ExpensesTable";
import { MonthFilter } from "@/components/expenses/MonthFilter";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const range = rangeFromParams(sp);
  const db = await dbForRequest();
  const expenses = listExpenses(db);
  const byCat = expensesByCategory(db, range);
  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" subtitle="Business costs" action={<MonthFilter />} />
      <div className="grid gap-4 sm:grid-cols-[auto,1fr] sm:items-start">
        <Stat label={range ? "Total (selected period)" : "Total expenses"} value={<Money cents={totalExpensesCents(db, range)} />} />
        <Card title="By category">
          {byCat.length === 0 ? <p className="text-sm text-slate-400">No expenses in range.</p> : (
            <ul className="space-y-1 text-sm">
              {byCat.map((c) => (
                <li key={c.category} className="flex justify-between gap-6">
                  <span>{c.category}</span><span className="font-medium"><Money cents={c.totalCents} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <ExpensesTable rows={expenses} />
      <ExpenseForm />
    </div>
  );
}
```

- [ ] **Step 6: De-offset the add form**

In `src/components/ExpenseForm.tsx`: change the Card title from `"Add expense (use negative for offsets/rebates)"` to `"Add expense"`, and the amount input placeholder from `"Amount $ (negative = offset)"` to `"Amount $"`.

- [ ] **Step 7: Verify build + type-check**

Run: `npm test -- expense-range && npx tsc --noEmit 2>&1 | grep -E "expenses|ExpensesTable|MonthFilter" || echo "clean"`
Expected: tests PASS; `clean`.

- [ ] **Step 8: Commit**

```bash
git add src/app/expenses/page.tsx src/components/expenses src/components/ExpenseForm.tsx src/lib/ui/expense-range.ts tests/lib/ui/expense-range.test.ts
git commit -m "feat(expenses): sortable list, category breakdown, month filter, delete, de-offset form"
```

---

### Task 5: Expense detail page with itemization

**Files:**
- Create: `src/app/expenses/[id]/page.tsx` (server component)
- Create: `src/components/expenses/ExpenseDetailEditor.tsx` (client: editable fields + itemization table)

**Interfaces:**
- Consumes: `getExpense` (Task 2), `listExpenseItems` (Task 1), `PATCH /api/expenses/:id`, `PUT /api/expenses/:id/items` (Task 3).

- [ ] **Step 1: Detail page (server)**

Create `src/app/expenses/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { dbForRequest } from "@/lib/auth/request";
import { getExpense } from "@/lib/db/expenses";
import { listExpenseItems } from "@/lib/db/expense-items";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { ExpenseDetailEditor } from "@/components/expenses/ExpenseDetailEditor";

export const dynamic = "force-dynamic";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = await dbForRequest();
  const expense = getExpense(db, id);
  if (!expense) notFound();
  const items = listExpenseItems(db, id);
  return (
    <div className="space-y-6">
      <PageHeader title="Expense detail" action={<Button variant="secondary" href="/expenses">‹ Back</Button>} />
      <ExpenseDetailEditor expense={expense} initialItems={items} />
    </div>
  );
}
```

- [ ] **Step 2: Detail editor (client)**

Create `src/components/expenses/ExpenseDetailEditor.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { formatUSD } from "@/lib/money";
import type { ExpenseRow } from "@/lib/db/expenses";
import type { ExpenseItemRow } from "@/lib/db/expense-items";

type ItemDraft = { name: string; qty: string; unit: string };
const toDraft = (r: ExpenseItemRow): ItemDraft => ({
  name: r.name, qty: r.qty == null ? "" : String(r.qty), unit: r.unitCents == null ? "" : (r.unitCents / 100).toFixed(2),
});

export function ExpenseDetailEditor({ expense, initialItems }: { expense: ExpenseRow; initialItems: ExpenseItemRow[] }) {
  const [f, setF] = useState({
    description: expense.description, type: expense.type, category: expense.category ?? "",
    amount: (expense.amountCents / 100).toFixed(2), incurredOn: expense.incurredOn ?? "",
  });
  const [items, setItems] = useState<ItemDraft[]>([...initialItems.map(toDraft), { name: "", qty: "", unit: "" }]);

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => {
      const next = prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
      if (i === next.length - 1 && next[i].name.trim() !== "") next.push({ name: "", qty: "", unit: "" });
      return next;
    });
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const lineTotal = (it: ItemDraft) =>
    it.qty && it.unit ? formatUSD(Math.round(Number(it.qty) * Number(it.unit) * 100)) : "—";
  const pricedTotal = items.reduce((s, it) =>
    it.qty && it.unit ? s + Math.round(Number(it.qty) * Number(it.unit) * 100) : s, 0);

  const save = async () => {
    await fetch(`/api/expenses/${expense.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, amount: f.amount, incurredOn: f.incurredOn || null }),
    });
    await fetch(`/api/expenses/${expense.id}/items`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.map((it) => ({ name: it.name, qty: it.qty || null, unit: it.unit || null })) }),
    });
    location.reload();
  };

  return (
    <div className="space-y-4">
      <Card title="Details">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Description
            <input className={`mt-1 w-full ${INPUT_CLASS}`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <label className="text-sm">Date
            <input type="date" className={`mt-1 w-full ${INPUT_CLASS}`} value={f.incurredOn} onChange={(e) => setF({ ...f, incurredOn: e.target.value })} /></label>
          <label className="text-sm">Type
            <select className={`mt-1 w-full ${INPUT_CLASS}`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ExpenseRow["type"] })}>
              <option value="one_time">One-time</option><option value="recurring">Recurring</option>
            </select></label>
          <label className="text-sm">Category
            <input className={`mt-1 w-full ${INPUT_CLASS}`} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></label>
          <label className="text-sm">Amount $
            <input className={`mt-1 w-full ${INPUT_CLASS}`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        </div>
      </Card>

      <Card title="Itemized details (reference only)">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr><th className="py-1 text-left">Item</th><th className="py-1 text-right">Qty</th>
              <th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Total</th><th /></tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-2"><input className={`w-full ${INPUT_CLASS}`} placeholder="Add item…" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} /></td>
                <td className="py-1 pr-2"><input className={`w-16 ${INPUT_CLASS} text-right`} value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></td>
                <td className="py-1 pr-2"><input className={`w-24 ${INPUT_CLASS} text-right`} value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} /></td>
                <td className="py-1 text-right text-slate-500">{lineTotal(it)}</td>
                <td className="py-1 pl-2 text-right">{i < items.length - 1 && (
                  <button onClick={() => removeItem(i)} className="text-slate-300 hover:text-red-600">×</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 border-t border-dashed border-line pt-2 text-xs text-slate-400">
          Items priced so far: {formatUSD(pricedTotal)} · Expense amount: {formatUSD(Math.round(Number(f.amount || 0) * 100))} <span className="text-slate-300">(they don’t need to match)</span>
        </p>
      </Card>

      <Button onClick={save}>Save</Button>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "expenses/\[id\]|ExpenseDetailEditor" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`, log in, open `/expenses`, click a row → detail page loads; edit amount + add an item with qty/price and one name-only item → Save → values persist after reload; back on `/expenses` the amount reflects the edit. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/expenses/[id] src/components/expenses/ExpenseDetailEditor.tsx
git commit -m "feat(expenses): itemized detail page with edit + line items"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1: Run the whole suite + type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all Vitest tests PASS (existing 177+ plus the new ones). Note: `tests/lib/db/giveaway-items.test.ts` has a pre-existing tsc error unrelated to this work (see business-rules memory) — tsc is not a clean gate on its own; confirm no NEW errors reference expense files.

- [ ] **Step 2: Final commit if anything outstanding**

```bash
git add -A && git commit -m "chore(expenses): finalize page update" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Edit expense → Task 2 (`updateExpense`) + Task 5 editor. ✓
- Delete expense → Task 2 (`deleteExpense`) + Task 4 (table delete). ✓
- Category free-text (no dropdown) → kept as plain input in ExpenseForm/editor. ✓
- Offsets removed → Task 4 Step 6 (form copy). ✓ (DB still allows any amount; no offset UI remains.)
- Sortable list → Task 4 ExpensesTable. ✓
- Detail page `/expenses/[id]` with Item/Qty/Unit/Total, qty+price optional, reference-only → Task 1 (nullable qty/unit), Task 5. ✓
- Category breakdown → Task 2 `expensesByCategory` + Task 4 page. ✓
- Month/date filter → Task 4 `rangeFromParams` + MonthFilter + range-aware totals. ✓
- Visual refresh via existing primitives → Tasks 4–5 use PageHeader/Stat/Card/DataTable/Button. ✓
- Integer cents throughout → all money via `Math.round(x*100)` / `formatUSD`. ✓
- Tests → Tasks 1, 2, 4 add Vitest coverage for db + range helper. ✓

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `ExpenseRow` (existing), `ExpenseItemRow` (Task 1) used consistently in Tasks 4–5; `DateRange` defined Task 2, consumed Task 4; API bodies match editor payloads (`amount`, `incurredOn`, `items[].unit`). ✓
