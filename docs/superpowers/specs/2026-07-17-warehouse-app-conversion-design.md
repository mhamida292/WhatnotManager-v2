# Warehouse App Conversion — Design

**Date:** 2026-07-17
**Status:** Approved (pending spec review)

## Context

This project began as a copy of the **Whatnot Business Manager** — a self-hosted
Next.js 15 + SQLite (better-sqlite3) app that tracks Whatnot show profit,
inventory, expenses, and invoices, with a multi-user registry and one isolated
SQLite workspace per user (`data/ws/<userId>.db`).

We are converting this copy into a **warehouse management app** for a single
business. Whatnot remains one channel within that business, so the Whatnot
tooling is kept as a self-contained module. The conversion adds warehouse
inventory features and two people-oriented modules (payroll, expense
reimbursement).

Money is stored as integer cents throughout the existing codebase; all new
money fields follow the same `_cents` convention. People are referenced by
**free-text names** — there is no managed employee roster in v1.

## Goals

1. Move from per-user isolated data to **one shared business dataset**, with
   login gating access (single access level — any logged-in user sees everything).
2. Extend warehouse inventory with **locations**, **receiving/stock-in**, and the
   existing **counts/audits** feature.
3. Add a **simple payroll** module (hours × rate, auto-calculated amount,
   pay-period range, month-filtered log).
4. Extend **expenses** with "who paid", a reimbursable flag, an
   outstanding→reimbursed toggle, and a per-person "who's owed" summary.
5. Keep the **Whatnot aggregator** intact, loosely linked to inventory via the
   existing alias/item mapping (no automatic stock deduction).

## Out of Scope (v1)

- Order fulfillment / picking / packing / shipping queue.
- Reorder points / low-stock thresholds.
- A managed employee roster (names stay free-text).
- Role tiers beyond the existing admin flag (which only gates Settings→Users).
- Full payroll (deductions, taxes, pay stubs, YTD) — explicitly declined in favor
  of the hours × rate model.

---

## 1. Access Model — Shared Workspace

**Current behavior:** `dbForRequest()` in `src/lib/auth/request.ts` calls
`getDb(user.id)`, opening `data/ws/<userId>.db` — one DB per user.

**Change:** Route every logged-in request to a single shared workspace DB.
`dbForRequest()` resolves to a fixed workspace id (e.g. `getDb(0)` →
`data/ws/shared.db`) rather than the caller's user id.

- The user **registry** (`data/users.db`), login, sessions, and the admin-only
  **Settings → Users** page all remain unchanged — they control *who may log in*.
- Every other page/API reads and writes the one shared DB.
- `is_admin` continues to gate only Settings → Users; all other features are
  available to any authenticated user.
- Legacy adoption: on first run, if a legacy `data/whatnot.db` exists and the
  shared workspace does not yet exist, adopt it as the shared DB (the existing
  `adoptLegacyDb` logic, retargeted to the fixed id).

**Files:** `src/lib/auth/request.ts`, `src/lib/db/connection.ts`.

## 2. Warehouse Inventory

### 2a. Locations
Add a nullable `location TEXT` column to `inventory_items`. Free-text
(e.g. `A3-2`, `Zone B / Shelf 4`).

- Shown as a column in the inventory table; editable via the existing
  Add/Edit item modals.
- Shown on the count sheet so stock can be physically located during a count.
- Migration: idempotent `ALTER TABLE inventory_items ADD COLUMN location TEXT`
  in `migrate()` (guarded by a `PRAGMA table_info` check, matching existing
  migration style).

### 2b. Receiving / Stock-In
A "Receive" action that logs an incoming batch into the existing
`item_purchases` table (which already drives derived on-hand totals via
`backfillPurchases` / purchase batches).

- Fields: item, quantity, unit cost (cents), received date, optional note.
- Distinct from a manual inventory adjustment: receiving records real incoming
  stock as a purchase batch, so cost/COGS math stays correct.
- Reuses existing purchase-insertion helpers in `src/lib/db/purchases.ts`.

### 2c. Counts / Audits
Keep the existing count-sheet / recount feature
(`src/app/inventory/count/`, `src/components/inventory/`) unchanged, augmented
only by displaying the new `location` field.

## 3. Payroll (New Module)

### Schema — `payroll_entries`
```
CREATE TABLE IF NOT EXISTS payroll_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  period_start TEXT,          -- ISO date
  period_end TEXT,            -- ISO date
  hours REAL,
  rate_cents INTEGER,
  amount_cents INTEGER NOT NULL,  -- auto = round(hours * rate_cents); editable override
  note TEXT
);
```

- `amount_cents` defaults to `hours × rate_cents` computed client-side, but is
  stored explicitly and can be overridden (e.g. a flat bonus with no hours).

### UI
- New **Payroll** page (`src/app/payroll/page.tsx`) added to nav.
- Entry form: period range, person (free-text), hours, rate, auto amount, note.
- **Month-filtered log** reusing the existing `MonthFilter` pattern
  (`src/components/expenses/MonthFilter.tsx`) and month-range helper
  (`src/lib/ui/expense-range.ts`), filtering on `period_end` (fallback
  `period_start`).
- Per-person subtotal and a month total.

### DB layer
New `src/lib/db/payroll.ts` mirroring the shape of `src/lib/db/expenses.ts`:
`insertPayroll`, `listPayroll(range)`, `getPayroll`, `updatePayroll`,
`deletePayroll`, `totalPayrollCents(range)`, `payrollByPerson(range)`.

## 4. Expenses — Who Paid & Reimbursement

### Schema additions to `expenses`
```
ALTER TABLE expenses ADD COLUMN paid_by TEXT;              -- free-text name
ALTER TABLE expenses ADD COLUMN reimbursable INTEGER NOT NULL DEFAULT 0;  -- 0/1
ALTER TABLE expenses ADD COLUMN reimbursed_on TEXT;        -- ISO date; NULL = outstanding
```
Idempotent migrations in `migrate()`, guarded by `PRAGMA table_info(expenses)`.

### Semantics
- **Company-paid** expense: `reimbursable = 0` (nothing owed to anyone).
- **Fronted** expense: `paid_by = <name>`, `reimbursable = 1`,
  `reimbursed_on = NULL` (outstanding) → set a date to mark reimbursed.
- The outstanding→reimbursed toggle sets/clears `reimbursed_on` (uses today's
  date when marking reimbursed).

### "Who's Owed" summary
On the expenses page, a summary that groups **reimbursable AND not-yet-reimbursed**
expenses by `paid_by`, showing the outstanding total owed to each person. New
helper `amountsOwedByPerson(db, range?)` in `src/lib/db/expenses.ts`.

### UI changes
- Expense form / detail editor: add "Paid by" text field and a "Reimbursable"
  checkbox.
- Expenses table: show paid-by and a reimbursement status control (toggle).
- "Who's owed" card at the top of the expenses page.

**Files:** `src/lib/db/expenses.ts`, `src/app/expenses/`,
`src/components/expenses/`, `src/components/ExpenseForm.tsx`.

## 5. Whatnot Aggregator (Kept, Loosely Linked)

No structural change. The Whatnot modules remain intact:

- Ledger CSV import (`src/lib/csv/ledger*.ts`, `src/app/api/ledger/`).
- Shows, show P&L, report (`src/app/shows/`, `src/app/report/`,
  `src/lib/calc/show-pnl.ts`, `ledger-report.ts`).
- Aliases and giveaways.

**Loose link:** the existing `product_aliases` / `show_line_items.item_id` /
`ledger_transactions.item_id` mapping lets a Whatnot product optionally reference
an `inventory_items` row. This mapping is retained as-is. There is **no automatic
warehouse stock deduction** when something sells on Whatnot — the link is
informational/optional only.

## 6. Branding & Navigation

- Rename the app (README, `package.json` `name`, page titles/header). Working
  placeholder: **"Warehouse Manager"** — final name TBD by owner, not a blocker.
- Add **Payroll** to the primary nav (`src/components/Nav.tsx`) alongside
  Inventory, Expenses, Whatnot (Shows/Report), Invoices, and Settings.

## Testing

Follow the existing Vitest setup (`vitest.config.ts`, `tests/`). Unit-test the
pure logic, mirroring existing `src/lib/calc` / `src/lib/db` test patterns:

- **Payroll:** amount auto-calc (`hours × rate`, rounding, override), month-range
  filtering, `payrollByPerson` grouping, `totalPayrollCents`.
- **Expenses:** `amountsOwedByPerson` correctly sums only reimbursable +
  outstanding expenses and groups by `paid_by`; reimbursed-toggle transitions.
- **Migrations:** new columns/tables are created idempotently on a fresh DB and
  on a pre-existing DB (added-column path), matching the guarded-migration tests
  that already exist for prior columns.
- **Access model:** `dbForRequest()` resolves to the fixed shared workspace id
  regardless of the logged-in user.

## Migration & Data Safety

- All schema changes are additive and idempotent, using the established
  `PRAGMA table_info` guard pattern in `connection.ts` `migrate()`.
- No destructive changes to existing tables; existing Whatnot/inventory/expense
  data is preserved.
- The shared-workspace switch changes *which* DB file is read; document that
  operators consolidating existing per-user data should copy the intended
  workspace file to `data/ws/shared.db` (or rely on legacy `whatnot.db`
  adoption).
