# Refunds + Non-Show Cleanup — Design

**Date:** 2026-07-06
**Status:** Approved design, pending spec review
**Area:** ledger classification (`src/lib/csv/ledger.ts`), migration (`src/lib/db/connection.ts`), ledger report (`src/lib/calc/ledger-report.ts` + a new refunds query), `/report` page.

## Motivation

Whatnot refunds currently vanish into the `other` bucket and quietly reduce a
show's payout with no label. Worse, refunds (and other stray adjustments) that
land on days the user didn't stream create **phantom "shows"** in the report's
Show breakdown (e.g. a refund-only date shows as a −$8 "show"). The user wants
to (1) **see refunds** — itemized, with the product each one reverses — and
(2) **stop non-show dates from appearing as shows**, without changing profit.

Confirmed from the user's real ledger (`2Gl1DUcQ.csv`): refunds are
`ADJUSTMENT` rows whose Message contains "refund" — 25 rows, −$105.05 — in two
forms: 21 "Reversal of sales transaction for order refund" (each carries the
original **Order ID**, so it maps to a specific sold product) and 4 "Deduction
for order refund shipping costs" (no order id — return shipping Whatnot ate).

## Core invariant

**Profit is unchanged.** Refunds already net into payout as negatives; a show's
payout is `SUM(amount) WHERE kind <> 'payout'`, and `refund` (like the old
`other`) is included in that sum — so reclassifying `other`→`refund` moves NO
money. The non-show cleanup is **display-only**: saleless "shows" are hidden
from the breakdown list but their money still counts in the grand total, shown
as one reconciling line. A guard test asserts grand-total profit is identical.

## Decisions

### 1. New `refund` ledger kind
- `LedgerKind` gains `"refund"`.
- `classify(txnType, message)`: inside the `ADJUSTMENT` branch, **check refund
  first** — `if (/refund/i.test(message)) return "refund";` — then the existing
  `Sales Match Bonus`→`bonus`, else `other`. (Refund and bonus messages are
  mutually exclusive, so order is safe; refund is checked explicitly.) Both the
  sale-reversal and shipping-cost-deduction messages contain "refund", so both
  become `refund` (per the user: shipping deductions are lumped in).

### 2. Migration to widen the CHECK + relabel existing rows
- `ledger_transactions.kind` CHECK must include `'refund'`. Mirror the existing
  `migrateLedgerPayoutKind` pattern exactly: a one-time, idempotent
  `migrateLedgerRefundKind(db)` guarded on whether the constraint text already
  contains `'refund'`; it rebuilds the table with the widened CHECK and then
  `UPDATE ledger_transactions SET kind='refund' WHERE txn_type='ADJUSTMENT' AND
  LOWER(message) LIKE '%refund%'`.
- `SCHEMA` (fresh DBs): add `'refund'` to the `ledger_transactions.kind` CHECK.
- Payout recomputation is NOT needed (refunds stay inside the `kind <> 'payout'`
  sum, so no show payout changes) — unlike the payout migration.

### 3. Refunds view on `/report` (total + itemized, option C)
- **Total card:** "Refunds — −$105.05 (25)".
- **Itemized table:** one row per refund — `Date · Product · Order # · Amount`.
  - Product resolved at report time by matching the refund's `order_id` to the
    original `sale` row's `product_name` (same `order_id`). Shipping-cost
    deductions (no order id) render as "Return shipping".
  - If the matched product maps to an inventory item (via `product_aliases`),
    the product links to `/inventory/[id]`; otherwise it's plain text.
- New query `listRefunds(db): RefundRow[]` where
  `RefundRow = { showDate: string; amountCents: number; orderId: string | null; productName: string | null; itemId: number | null; isShipping: boolean }`.
  Ordered newest-first.

### 4. Non-show cleanup (display filter + reconciling line)
- `buildLedgerReport` show objects gain `saleCount: number` (count of `kind='sale'`
  transactions in that show).
- Shows are listed in TWO places, both of which must filter to `saleCount > 0`:
  the **dashboard** "Show breakdown" table (`src/app/page.tsx`) AND the **`/report`**
  per-show cards (`src/app/report/page.tsx`). The dashboard's net-profit show
  count and ProfitChart points also use only `saleCount > 0` shows.
- Shows with `saleCount === 0` are summed into one **"Non-show activity (refunds,
  fees, claims)"** reconciling line (sum of their `net`), shown on the dashboard
  breakdown (and on `/report`).
- Grand-total profit is unchanged: `dashboardSummary`/`buildLedgerReport` totals
  still sum ALL shows, so `Σ(visible show nets) + non-show line = grand total`. No
  change to show creation, `saveLedger`, or `regroupLedgerShows` — purely a
  presentation-layer filter.

## Components / files
- `src/lib/csv/ledger.ts` — add `"refund"` to `LedgerKind`; refund rule in `classify`.
- `src/lib/db/connection.ts` — `migrateLedgerRefundKind(db)` called from `migrate()`.
- `src/lib/db/schema.ts` — add `'refund'` to the `ledger_transactions.kind` CHECK.
- `src/lib/calc/ledger-report.ts` — add `saleCount` per show; keep grand total over all shows.
- `src/lib/db/ledger-refunds.ts` (NEW) — `listRefunds(db)` (refund→sale order-id join + alias→item link) and a `refundsTotalCents(db)` helper.
- `src/app/report/page.tsx` — filter Show breakdown to `saleCount > 0`; add the
  non-show reconciling line; render the Refunds card + itemized table.
- Small presentational components as needed (a `RefundsTable`), following existing report styling.

## Error handling
- A refund whose `order_id` matches no sale in the data → `productName = null`
  (renders "Unknown item" / plain), never an error.
- Migration is idempotent (guarded on the constraint text) — safe on every boot
  and on re-import.
- No user input is involved (read-only report surface).

## Testing (Vitest)
- `classify`: `ADJUSTMENT`+"...refund..." → `refund` (both reversal and shipping
  messages); `ADJUSTMENT`+"Sales Match Bonus" → `bonus` still; Show Boost /
  Insurance Claim → `other`.
- **Migration:** insert a raw `ledger_transactions` row with `kind='other'`,
  `txn_type='ADJUSTMENT'`, refund message; run `migrateLedgerRefundKind`; assert
  it becomes `kind='refund'` and that a show's `payout_cents` is unchanged.
- **Invariant guard:** build a report with a mapped sale + a same-order refund;
  assert grand-total profit is byte-identical whether the refund row is `other`
  or `refund` (proves reclassification moves no money).
- `listRefunds`: matches product via `order_id`; shipping deduction → null
  product + `isShipping`; total equals the sum of refund amounts.
- `buildLedgerReport`: `saleCount` correct; a refund-only date has `saleCount 0`
  (so it's filtered from the breakdown) while its net still lands in the grand total.

## Out of scope / deferred
- Reversing COGS or returning refunded items to stock (user chose display-only).
- Changing show creation / `regroupLedgerShows` to delete saleless shows in the
  DB (we keep them and filter at the report layer, preserving profit + simplicity).
- Refunds on the dashboard or a dedicated `/refunds` page (report-only for now).
