# Feature Ideas

Requested-but-not-built features to revisit. Each needs its own brainstorm →
spec → implementation pass.

## Year-end tax summary

**Requested:** 2026-06-24.

A single per-year (or per-date-range) summary a CPA can use at tax time, laid out
like a Schedule C:

- **Income** — total payout = sales + tips + the $400 bonus (the ledger payout).
- **COGS** — cost of the inventory that actually sold this period.
- **Deductible expenses** — total from the Expenses page (shipping supplies,
  equipment, fees, etc.).
- **Ending inventory value** — unsold stock = Σ `remaining × unit_cost`. This is
  a balance-sheet figure, **not** a deduction until the stock sells.

All these numbers already exist (`buildLedgerReport` totals + `totalExpensesCents`
+ `inStockSummary` value); the feature is rolling them up **by year** and making
them export-friendly (print/CSV) to hand to a tax preparer.

## Partner / employee entity

**Requested:** 2026-06-24.

Model the partner (currently a hard-coded 80/20 split %) — and possibly
employees — as first-class records rather than a single setting.

**Why it matters:** the correct tax treatment depends on what the partner *is*:
a true co-owner (partnership → Form 1065 + K-1s), a contractor (1099-NEC), or a
simple profit share. That choice affects who reports the income and who deducts
COGS/expenses.

**Likely scope:** named partner(s)/employee(s), each with a share or pay
arrangement, and reporting that reflects it. Ties into the owner/partner split
math (`splitProfit` in `src/lib/calc/show-pnl.ts`). Needs a brainstorm before
building.

> Tax note: consult a CPA/EA for the actual entity treatment — this app tracks
> the numbers (income, COGS, expenses), not the filing strategy.
