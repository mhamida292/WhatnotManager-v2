# Expenses Page Redesign — Design

**Date:** 2026-07-18
**Status:** Approved (pending spec review)

## Context

The expenses page (`src/app/expenses/page.tsx`) works but reads as messy: three
summary cards sit in a lopsided `grid-cols-[auto,1fr]` grid (Total + Who's-owed
stack on the left while By-category towers on the right), the only time filter is
a bare, unlabeled `<input type="month">` that renders as an empty pill, and a
large always-open "Add expense" form stacks below the table, forcing scroll.

This redesign cleans up the layout, adds week-level filtering, moves the add-form
into a modal, and tightens the table — implementing the "Version A" mockup the
owner approved.

## Goals

1. **Period filter** — a labeled segmented control to view expenses by week, by
   month, or all-time, replacing the bare month picker.
2. **Even summary row** — the three cards become one clean, responsive row.
3. **Add via modal** — move the add-expense form behind a `＋ Add expense` button
   in the header.
4. **Cleaner table** — drop the low-value Type column from the main table.
5. **All-time "Who's owed"** — the outstanding-balance card ignores the period
   filter (a running total), closing a previously-flagged review issue.

## Out of Scope

- Changing expense data model, categories, or the reimbursement logic.
- The expense **detail** page (`/expenses/[id]`) — unchanged (Type still shown there).
- Payroll or any other page (the payroll "day by day" question is separate).

---

## 1. Period Filter

### URL scheme
The page's effective time range is driven by search params:

- `?week=YYYY-Www` (ISO week, e.g. `2026-W29`) → that ISO week, Monday–Sunday.
- `?month=YYYY-MM` → that whole month (existing behavior).
- `?all=1` → all time (no date bound).
- **No param → default to the current ISO week** ("This week").

Because the default is *this week* (not all-time), "All time" must be an explicit
param (`?all=1`); an absent param is never "all time" here.

### Component: `PeriodFilter` (replaces `MonthFilter`)
A client component in the page header showing:

```
[ Week | Month | All time ]   ‹Week→ 📅 <input type="week">   Month→ <input type="month">›
```

- Segmented buttons set the mode:
  - **Week** → navigate to `?week=<current-or-existing week>`.
  - **Month** → navigate to `?month=<current-or-existing month>`.
  - **All time** → navigate to `?all=1`.
- The active mode is derived from the present param (`week` → Week, `month` →
  Month, `all` → All time, none → Week).
- When mode is Week, render `<input type="week">` bound to the `week` param;
  when Month, render `<input type="month">` bound to `month`; when All time,
  render neither. Changing the input navigates to the new value.
- Styling matches the mockup: segmented control with the active segment in
  brand green (`bg-brand-600 text-white`), inputs using the app's rounded
  border style.

### Range expansion: `rangeFromParams` + `weekRange`
Extend `src/lib/ui/expense-range.ts`:

- New pure helper `weekRange(isoWeek: string): DateRange | undefined` — parses
  `YYYY-Www` and returns `{ from: <Monday ISO date>, to: <Sunday ISO date> }`
  using ISO-8601 week rules (weeks start Monday; ISO week 1 is the week
  containing that year's first Thursday). Returns `undefined` for malformed input.
- `rangeFromParams(p)` precedence becomes: explicit `from`/`to` → `week` (via
  `weekRange`) → `month` (existing expansion) → **if none present, expand the
  current ISO week** → and `all` short-circuits to `undefined` (all time).
  - Because "no param" now means "current week," the page passes a computed
    `week` default rather than relying on `undefined`. To keep `rangeFromParams`
    pure and testable, the **page** computes `sp.week ??= currentIsoWeek()` when
    no period param is set, then calls `rangeFromParams`. `rangeFromParams`
    itself stays deterministic on its input (no "now" dependency), and a small
    `currentIsoWeek()` helper (also in `expense-range.ts`) provides the default.
  - `?all=1` → `rangeFromParams` returns `undefined` (all time).

This keeps the date math pure and unit-testable, with `Date.now()` isolated to
`currentIsoWeek()` and the page.

## 2. Even Summary Row

Replace the current `grid-cols-[auto,1fr]` block with a responsive even grid:

```tsx
<div className="grid gap-4 sm:grid-cols-3">
  <Stat .../>   {/* Total (label reflects active period) */}
  <Card title="By category">...</Card>
  <Card title="Who's owed">...</Card>
</div>
```

- On mobile the cards stack (single column); at `sm` and up they form three
  equal columns.
- The Total card's label reflects the active period: "Total (this week)",
  "Total (July 2026)", or "Total expenses" (all time). A small
  `periodLabel(params)` helper in the page or `expense-range.ts` produces the
  suffix; keep it simple (week → "this week"/"selected week", month → month name,
  all → all-time).

## 3. Add Expense Modal

- Add a `＋ Add expense` button to the `PageHeader` action area (alongside the
  `PeriodFilter`).
- New client component `AddExpenseButton` that manages open state and renders the
  existing `ExpenseForm` inside the existing `Modal` component
  (`src/components/ui/Modal.tsx`). Reuse `ExpenseForm` as-is — it already POSTs and
  reloads on submit; no logic change.
- Remove the always-rendered `<ExpenseForm />` from the bottom of the page.
- If `PageHeader`'s `action` slot only fits one node, wrap the filter + button in
  a flex container passed as `action`.

## 4. Cleaner Table

In `src/components/expenses/ExpensesTable.tsx`:

- Remove the **Type** column (header + cell) and drop `"type"` from the `Key`
  sort union and any `arrow`/`toggle` usage for it.
- Remaining columns: Date · Description · Category · Paid by · Amount ·
  Reimbursed · (delete action). Update the empty-state `colSpan` accordingly
  (from 8 to 7).
- No change to sorting behavior for the remaining columns, the reimburse toggle,
  or the delete action.
- Type remains visible on the expense detail page — no change there.

## 5. "Who's Owed" Is All-Time

In `src/app/expenses/page.tsx`, call `amountsOwedByPerson(db)` with **no range**
so the card always reflects total outstanding reimbursables regardless of the
selected period. Label the card "Who's owed" with a small "(all-time)" hint, per
the mockup. `Total` and `By category` remain period-scoped.

## Testing

Follow the existing Vitest patterns (`tests/lib/ui/expense-range.test.ts`,
`tests/lib/db/expenses*.test.ts`):

- **`weekRange`** (pure): `2026-W29` → `{ from: "2026-07-13", to: "2026-07-19" }`
  (Mon–Sun); a week spanning a year boundary (e.g. `2026-W01`); malformed input
  (`"2026-29"`, `""`, `"2026-W99"`) → `undefined`.
- **`rangeFromParams`** precedence: `week` expands via `weekRange`; `month` still
  expands; `all` → `undefined`; explicit `from`/`to` still win; a bare `week`
  beats a simultaneously-present `month` (define and test the precedence order).
- **`currentIsoWeek`**: returns a `YYYY-Www` string for a known injected date (if
  it takes an optional `Date` arg for testability) — otherwise test `weekRange`
  round-trips its output.
- Existing expenses DB/UI tests must stay green; the Type-column removal is a
  view change with no new logic to test beyond confirming the suite passes.

## Migration & Data Safety

- No schema or data changes. Pure UI/query-scoping redesign.
- `MonthFilter` is replaced by `PeriodFilter`; confirm no other page imports
  `MonthFilter` before removing it (grep) — if it is used elsewhere, leave it and
  only swap the expenses page.
