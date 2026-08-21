# Expenses Page Update — Design

**Date:** 2026-07-04
**Status:** Approved design, pending spec review
**Area:** `/expenses` page, `ExpenseForm`, `src/lib/db/expenses.ts`, new `/expenses/[id]` detail page

## Motivation

The current expenses page is minimal and has three shortcomings the user wants addressed:

- **(A) Clunky data entry** — rows are permanent once added; no way to edit or delete.
- **(B) Not enough insight** — a single lifetime "Total expenses" number, no breakdown or time filtering.
- **(D) Visually bare** — sparse compared to the rest of the app.

Explicitly **out of scope:** the deferred "how do expenses factor into profit / the 80/20 split" decision. This update is about managing and viewing expenses, not changing profit math.

## Decisions

### Data entry (A)
- **Edit** an existing expense (description, type, category, amount, date).
- **Delete** an expense.
- Category stays **free-text** (no dropdown) — user did not want that.
- **Offsets removed.** The "negative = offset" convention is dropped entirely. The
  form no longer mentions offsets; the stat becomes plain "Total expenses." This
  matches current reality: the $400 Whatnot incentive already comes from the
  ledger, not the expenses table, so offsets here were vestigial.

### Sorting
- The expense list is **sortable by column** (date, description, type, category, amount).
- Click a column header to sort; click again to reverse. Client-side sort over the
  fetched rows (dataset is small).

### Detail / itemization page — the main new piece
- Clicking an expense row opens a **dedicated detail page** at `/expenses/[id]`.
- The page shows the expense's fields (editable) plus an **itemization table**:
  `Item · Qty · Unit price · Line total`.
- **Qty and unit price are optional per row.** A row can be just an item name
  ("misc packing supplies") with no numbers. `Line total` auto-fills only when
  both qty and unit price are present.
- **Itemization is reference-only.** It does NOT need to reconcile with the
  expense's amount. The amount typed on the expense is the source of truth; the
  itemization exists to jog the user's memory ("which materials were in this
  $84.20 shipping-supplies buy?"). Chosen because the user won't always know
  per-item prices.
- Add/remove item rows freely on the detail page.

### Insight up top (B)
- **Category breakdown** — subtotals per category (e.g. Shipping $284.20,
  Displays $150.00…), a compact list/card.
- **Month / date-range filter** — pick a month (or custom range); the total and
  the category breakdown reflect the selected range.
- **Dropped:** one-time vs recurring split; gross/net offset widget (gone with offsets).

### Visual refresh (D)
- Reuse existing building blocks (`PageHeader`, `Stat`, `DataTable`, `Card`,
  `Money`, `Button`, `INPUT_CLASS`) so the page matches the rest of the app —
  polished but consistent, not a bespoke redesign.

## Data model

New table for itemized line items (one expense → many items):

```
expense_items
  id            INTEGER PK
  expense_id    INTEGER NOT NULL  REFERENCES expenses(id) ON DELETE CASCADE
  name          TEXT NOT NULL
  qty           REAL     NULL     -- optional
  unit_cents    INTEGER  NULL     -- optional, unit price in cents
  sort_order    INTEGER  NOT NULL DEFAULT 0
```

- `line_total_cents` is derived (`qty * unit_cents`) when both present — not stored.
- `expenses` table is unchanged in shape. No offset column ever existed; nothing to migrate there.
- Money stays integer cents everywhere (project rule).

## Components / files

- `src/lib/db/expenses.ts` — add `updateExpense`, `deleteExpense`, `getExpense`,
  and `expense_items` CRUD (`listItems`, `replaceItems` or add/remove).
  Add `expensesByCategory(db, range?)` and range-aware `totalExpensesCents`.
- `src/app/expenses/page.tsx` — sortable table, category-breakdown card, month
  filter control, links each row to `/expenses/[id]`.
- `src/app/expenses/[id]/page.tsx` — NEW detail page: editable fields + itemization table.
- `src/components/ExpenseForm.tsx` — drop offset wording; keep add flow.
- New client components as needed for edit/delete, the itemization editor, the
  month filter, and sortable headers.
- `src/app/api/expenses/route.ts` + new `/api/expenses/[id]` — PATCH (edit),
  DELETE, and item endpoints.

## Error handling
- Amount parsing rejects non-numeric input; empty amount blocked.
- Delete asks for confirmation.
- Item rows with a blank name are ignored on save.
- Detail page 404s cleanly for an unknown id.

## Testing
- Unit tests (Vitest, matching existing `tests/lib/db/expenses.test.ts`):
  update/delete/get expense; item CRUD; `expensesByCategory` and range totals
  (including boundary dates); items with missing qty/price don't break totals.

## Out of scope / deferred
- Category dropdown / normalization.
- Profit & owner/partner split treatment of expenses (separate open decision).
- One-time vs recurring reporting.
