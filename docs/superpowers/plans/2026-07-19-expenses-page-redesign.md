# Expenses Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the expenses page: a week/month/all period filter (default this week), an even summary-card row, the add-expense form moved into a modal, a cleaner table (Type column dropped), and an always-all-time "Who's owed" card.

**Architecture:** Next.js 15 App Router + React 19 + Tailwind. Date-range math stays pure and unit-tested in `src/lib/ui/expense-range.ts`; the page composes server-rendered summary cards + table with a client `PeriodFilter` and an `AddExpenseButton` modal. No DB/schema changes.

**Tech Stack:** TypeScript, Next.js 15, React 19, Tailwind 3, Vitest 2.

## Global Constraints

- Money is integer cents (`Cents` suffix). Not changed here.
- Date-range logic lives in `src/lib/ui/expense-range.ts` and must stay pure/testable (no `Date.now()` except inside `currentIsoWeek`, which takes an optional `Date` for tests).
- ISO-8601 weeks: Monday–Sunday, week 1 contains the year's first Thursday. `weekRange("2026-W29") === { from: "2026-07-13", to: "2026-07-19" }`.
- Filter URL scheme: `?week=YYYY-Www` | `?month=YYYY-MM` | `?all=1` | (none → default current week). "All time" is only ever the explicit `?all=1`.
- Reuse existing UI kit: `PageHeader`, `Stat`, `Card`, `Money`, `Modal`, `Button`, `ExpenseForm`, `INPUT_CLASS`.
- Tests live in `tests/**/*.test.ts`, run with `npm test`; single file `npx vitest run <path>`.
- `MonthFilter` is used only by the expenses page (payroll has its own `PayrollMonthFilter`); it may be removed once `PeriodFilter` replaces it.

---

### Task 1: Week-range date helpers + `rangeFromParams` extension

Pure ISO-week helpers and extend the range parser for week/all params.

**Files:**
- Modify: `src/lib/ui/expense-range.ts`
- Test: `tests/lib/ui/expense-range.test.ts` (extend)

**Interfaces:**
- Produces:
  - `weekRange(isoWeek: string): DateRange | undefined` — ISO week → Mon–Sun `{from,to}`; `undefined` if malformed.
  - `currentIsoWeek(d?: Date): string` — `YYYY-Www` for `d` (default now).
  - `periodLabel(p: { week?: string; month?: string; all?: string }): string` — human label for the Total card ("this week" / month name / "all time").
  - `rangeFromParams(p)` now also accepts `week?` and `all?`.
- Consumes: existing `DateRange` from `@/lib/db/expenses`.

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/ui/expense-range.test.ts`:

```ts
import { weekRange, currentIsoWeek, periodLabel, rangeFromParams } from "@/lib/ui/expense-range";

describe("weekRange", () => {
  it("expands an ISO week to Mon–Sun", () => {
    expect(weekRange("2026-W29")).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });
  it("handles a year-boundary week", () => {
    expect(weekRange("2026-W01")).toEqual({ from: "2025-12-29", to: "2026-01-04" });
  });
  it("returns undefined for malformed input", () => {
    expect(weekRange("2026-29")).toBeUndefined();
    expect(weekRange("")).toBeUndefined();
    expect(weekRange("2026-W99")).toBeUndefined();
  });
});

describe("currentIsoWeek", () => {
  it("returns the ISO week string for a given date", () => {
    expect(currentIsoWeek(new Date("2026-07-18T12:00:00Z"))).toBe("2026-W29");
    expect(currentIsoWeek(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01");
  });
  it("round-trips through weekRange", () => {
    const wk = currentIsoWeek(new Date("2026-07-18T12:00:00Z"));
    expect(weekRange(wk)).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });
});

describe("rangeFromParams week/all", () => {
  it("expands a week param", () => {
    expect(rangeFromParams({ week: "2026-W29" })).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });
  it("all short-circuits to undefined (all time)", () => {
    expect(rangeFromParams({ all: "1", week: "2026-W29" })).toBeUndefined();
  });
  it("week beats a simultaneously-present month", () => {
    expect(rangeFromParams({ week: "2026-W29", month: "2026-07" })).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });
  it("still expands month when no week", () => {
    expect(rangeFromParams({ month: "2026-07" })).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
});

describe("periodLabel", () => {
  it("labels each mode", () => {
    expect(periodLabel({ week: "2026-W29" })).toBe("this week");
    expect(periodLabel({ month: "2026-07" })).toBe("July 2026");
    expect(periodLabel({ all: "1" })).toBe("all time");
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run tests/lib/ui/expense-range.test.ts`
Expected: FAIL — `weekRange`/`currentIsoWeek`/`periodLabel` not exported; week/all not handled.

- [ ] **Step 3: Implement the helpers**

Replace the contents of `src/lib/ui/expense-range.ts` with:

```ts
import type { DateRange } from "@/lib/db/expenses";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** ISO-8601 week (Mon–Sun) for `YYYY-Www`; undefined if malformed or out of range. */
export function weekRange(isoWeek: string): DateRange | undefined {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!m) return undefined;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return undefined;
  // Monday of ISO week 1 = the Monday on/before Jan 4.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Dow + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

/** ISO week string (YYYY-Www) for a date (default now). */
export function currentIsoWeek(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dow + 3); // Thursday of this week
  const year = date.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.floor((date.getTime() - jan1.getTime()) / 86400000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** Human label for the active period, for the Total card. */
export function periodLabel(p: { week?: string; month?: string; all?: string }): string {
  if (p.all) return "all time";
  if (p.week) return "this week";
  if (p.month && /^\d{4}-\d{2}$/.test(p.month)) {
    const [y, m] = p.month.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  return "this week";
}

/** Build a DateRange from URL search params.
 *  Precedence: all → (from/to) → week → month → undefined (all time).
 *  A malformed week falls through to month. */
export function rangeFromParams(p: { month?: string; from?: string; to?: string; week?: string; all?: string }): DateRange | undefined {
  if (p.all) return undefined;
  if (p.from || p.to) return { from: p.from, to: p.to };
  if (p.week) {
    const r = weekRange(p.week);
    if (r) return r;
  }
  if (p.month && /^\d{4}-\d{2}$/.test(p.month)) {
    const [y, m] = p.month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${p.month}-01`, to: `${p.month}-${String(last).padStart(2, "0")}` };
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/lib/ui/expense-range.test.ts`
Expected: PASS (all, including the pre-existing month tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/lib/ui/expense-range.ts tests/lib/ui/expense-range.test.ts
git commit -m "feat(expenses): week-range helpers + rangeFromParams week/all support"
```

---

### Task 2: `PeriodFilter` component

Client segmented control (Week | Month | All time) + a native input, replacing `MonthFilter`.

**Files:**
- Create: `src/components/expenses/PeriodFilter.tsx`
- Delete: `src/components/expenses/MonthFilter.tsx` (after Task 3 stops importing it — do the delete in Task 3)

**Interfaces:**
- Produces: `PeriodFilter` (client component; reads its own state from `useSearchParams`, navigates via `useRouter`).
- Consumes: `currentIsoWeek` (Task 1).

- [ ] **Step 1: Implement the component**

```tsx
// src/components/expenses/PeriodFilter.tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { currentIsoWeek } from "@/lib/ui/expense-range";

type Mode = "week" | "month" | "all";

export function PeriodFilter() {
  const router = useRouter();
  const params = useSearchParams();
  const week = params.get("week") ?? "";
  const month = params.get("month") ?? "";
  const all = params.get("all");
  const mode: Mode = all ? "all" : month ? "month" : "week";

  const go = (qs: string) => router.push(qs ? `/expenses?${qs}` : "/expenses");
  const pickMode = (m: Mode) => {
    if (m === "all") go("all=1");
    else if (m === "month") go(`month=${month || new Date().toISOString().slice(0, 7)}`);
    else go(`week=${week || currentIsoWeek()}`);
  };

  const seg = (m: Mode, label: string) => (
    <button
      onClick={() => pickMode(m)}
      className={`px-3 py-1.5 text-sm ${mode === m ? "bg-brand-600 font-semibold text-white" : "text-slate-600 hover:bg-slate-50"}`}
    >{label}</button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div className="inline-flex overflow-hidden rounded-xl border border-line bg-white">
        {seg("week", "Week")}{seg("month", "Month")}{seg("all", "All time")}
      </div>
      {mode === "week" && (
        <input type="week" value={week || currentIsoWeek()} onChange={(e) => go(`week=${e.target.value}`)}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm" />
      )}
      {mode === "month" && (
        <input type="month" value={month || new Date().toISOString().slice(0, 7)} onChange={(e) => go(`month=${e.target.value}`)}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (component compiles; not yet imported anywhere).

- [ ] **Step 3: Commit**

```bash
git add src/components/expenses/PeriodFilter.tsx
git commit -m "feat(expenses): PeriodFilter segmented week/month/all control"
```

---

### Task 3: `AddExpenseButton` modal

Move the add-expense form behind a header button that opens a modal.

**Files:**
- Create: `src/components/expenses/AddExpenseButton.tsx`

**Interfaces:**
- Produces: `AddExpenseButton` (client) — a `＋ Add expense` button opening `Modal` containing the existing `ExpenseForm`.
- Consumes: `Modal`, `Button`, `ExpenseForm` (unchanged — it already POSTs and `location.reload()`s on submit).

- [ ] **Step 1: Implement**

```tsx
// src/components/expenses/AddExpenseButton.tsx
"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ExpenseForm } from "@/components/ExpenseForm";

export function AddExpenseButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>＋ Add expense</Button>
      {open && (
        <Modal title="Add expense" onClose={() => setOpen(false)}>
          <ExpenseForm />
        </Modal>
      )}
    </>
  );
}
```

Note: `ExpenseForm` is currently wrapped in its own `<Card title="Add expense">`. Since the modal already shows the "Add expense" title, remove the outer `<Card>` wrapper inside `ExpenseForm` so it renders bare inside the modal (keep the `<form>` and inputs exactly as-is). Verify `ExpenseForm` has no other consumer that relied on the Card: `grep -rn "ExpenseForm" src` — only the expenses page uses it, and Task 4 wires it through this button.

- [ ] **Step 2: Adjust `ExpenseForm`**

In `src/components/ExpenseForm.tsx`, replace the outer `<Card title="Add expense"> … </Card>` wrapper with a bare `<div>` (or fragment) so the modal owns the title. Keep the form, inputs, and submit logic identical.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/components/expenses/AddExpenseButton.tsx src/components/ExpenseForm.tsx
git commit -m "feat(expenses): add-expense modal button"
```

---

### Task 4: Drop the Type column from the table

**Files:**
- Modify: `src/components/expenses/ExpensesTable.tsx`

**Interfaces:** none external.

- [ ] **Step 1: Remove the Type column**

In `src/components/expenses/ExpensesTable.tsx`:
- Remove `"type"` from the `Key` union type.
- Remove the `<H k="type" label="Type" />` header cell.
- Remove the `<td …>{e.type === "recurring" ? "Recurring" : "One-time"}</td>` body cell.
- Update the empty-state row `colSpan` from `8` to `7`.
Leave all other columns, sorting, the reimburse toggle, and delete action unchanged.

- [ ] **Step 2: Typecheck + existing tests**

Run: `npx tsc --noEmit && npx vitest run tests/lib/db/expenses.test.ts tests/lib/db/expenses-reimbursement.test.ts`
Expected: clean; tests green (no logic change).

- [ ] **Step 3: Commit**

```bash
git add src/components/expenses/ExpensesTable.tsx
git commit -m "feat(expenses): drop Type column from the table"
```

---

### Task 5: Expenses page — assemble the redesign

Even card row, PeriodFilter + AddExpenseButton in the header, default-to-this-week, all-time Who's-owed, period-labeled total. Remove the inline form and `MonthFilter`.

**Files:**
- Modify: `src/app/expenses/page.tsx`
- Delete: `src/components/expenses/MonthFilter.tsx`

**Interfaces:**
- Consumes: `rangeFromParams`, `currentIsoWeek`, `periodLabel` (Task 1); `PeriodFilter` (Task 2); `AddExpenseButton` (Task 3); `amountsOwedByPerson` (existing).

- [ ] **Step 1: Rewrite the page**

Replace `src/app/expenses/page.tsx` with:

```tsx
import { Suspense } from "react";
import { dbForRequest } from "@/lib/auth/request";
import { listExpenses, totalExpensesCents, expensesByCategory, amountsOwedByPerson } from "@/lib/db/expenses";
import { rangeFromParams, currentIsoWeek, periodLabel } from "@/lib/ui/expense-range";
import { ExpensesTable } from "@/components/expenses/ExpensesTable";
import { PeriodFilter } from "@/components/expenses/PeriodFilter";
import { AddExpenseButton } from "@/components/expenses/AddExpenseButton";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  // Default to the current week when no period param is present.
  const hasPeriod = sp.week || sp.month || sp.all || sp.from || sp.to;
  const effective = hasPeriod ? sp : { ...sp, week: currentIsoWeek() };
  const range = rangeFromParams(effective);

  const db = await dbForRequest();
  const expenses = listExpenses(db, range);
  const byCat = expensesByCategory(db, range);
  const owed = amountsOwedByPerson(db); // all-time, ignores the period filter

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle="Business costs"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Suspense fallback={null}><PeriodFilter /></Suspense>
            <AddExpenseButton />
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={`Total (${periodLabel(effective)})`} value={<Money cents={totalExpensesCents(db, range)} />} />
        <Card title="By category">
          {byCat.length === 0 ? <p className="text-sm text-slate-400">No expenses in range.</p> : (
            <ul className="space-y-1 text-sm">
              {byCat.map((c) => (
                <li key={c.category ?? "_uncategorized"} className="flex justify-between gap-6">
                  <span>{c.category}</span><span className="font-medium"><Money cents={c.totalCents} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Who's owed (all-time)">
          {owed.length === 0 ? <p className="text-sm text-slate-400">Nobody is owed.</p> : (
            <ul className="space-y-1 text-sm">
              {owed.map((o) => (
                <li key={o.person} className="flex justify-between gap-6">
                  <span>{o.person}</span><span className="font-medium"><Money cents={o.totalCents} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <ExpensesTable rows={expenses} />
    </div>
  );
}
```

- [ ] **Step 2: Delete `MonthFilter`**

```bash
git rm src/components/expenses/MonthFilter.tsx
```
Confirm nothing else imports it: `grep -rn "expenses/MonthFilter\|{ MonthFilter }" src` returns nothing (payroll uses its own `PayrollMonthFilter`).

- [ ] **Step 3: Typecheck + full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests green.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: builds; `/expenses` present, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/expenses/page.tsx
git commit -m "feat(expenses): redesigned page — period filter, even cards, modal, all-time owed"
```

---

### Task 6: Verify end-to-end

- [ ] **Step 1: Drive the redesigned page**

Boot an isolated dev instance (fresh `DATA_DIR`, per the project's smoke pattern), create an admin, log in, then via the UI/API:
- Confirm `/expenses` defaults to **this week** (Total label reads "this week").
- Switch the segmented control to **Month** and **All time**; confirm the URL param and the visible range/label change.
- Open **＋ Add expense**, add a reimbursable expense paid by a name; confirm it appears and "Who's owed (all-time)" shows it regardless of the selected week.
- Add an expense dated in a different week; switch weeks and confirm the table filters, but "Who's owed" stays all-time.
- Confirm the table has **no Type column**.

- [ ] **Step 2: Record results, commit any fixes**

If fixes were needed, commit them. Otherwise the branch is ready to merge to `main`.
