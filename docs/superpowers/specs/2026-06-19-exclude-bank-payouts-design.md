# Exclude bank payouts from show P&L — design

**Date:** 2026-06-19

## Problem

Whatnot's account-ledger CSV includes `PAYOUT` transactions — withdrawals of
already-earned balance to the user's bank. These are **transfers of money the
user already earned**, not income or expense. The ledger classifier
(`src/lib/csv/ledger.ts`) doesn't recognize `PAYOUT`, so it falls into the
catch-all `other` kind, and because a show's payout is the sum of **all** its
transactions for that date, the withdrawal is subtracted from that day's show
payout — corrupting the show's P&L.

Observed in live data: one `PAYOUT` row of **−$534.39** is folded into a show,
dragging the dashboard's Total payout from a correct **$2915.47** down to
**$2381.08**.

Note: the four `ADJUSTMENT`/`other` rows (refund reversals, −$12.27 total) are
**correct as-is** — they are real money clawed back on refunded orders and
should keep reducing the relevant show's payout. Only `PAYOUT` is wrong.

## Goal

- A `PAYOUT` transaction must never affect any show's payout or any profit
  total.
- Withdrawals are still stored, and their running total is surfaced on the
  dashboard as a single **"Paid to bank"** figure for bank reconciliation.
- Fix existing data (the already-imported PAYOUT row), not just future imports.

## Non-goals

- No per-show withdrawal breakdown on `/report` (user decision 2026-06-19: a
  single dashboard total is enough).
- No change to how `ADJUSTMENT` refund rows are handled.

## Approach: dedicated `payout` kind

A bank transfer is genuinely its own transaction kind, so model it as one
rather than special-casing `txn_type` at every sum site.

### 1. Classifier — `src/lib/csv/ledger.ts`
- Add `"payout"` to the `LedgerKind` union.
- In `classify()`, make the first check `if (txnType === "PAYOUT") return "payout";`.
  Withdrawals carry no product/message of interest, so nothing else changes.

### 2. Schema — `src/lib/db/schema.ts`
- Widen the `ledger_transactions.kind` CHECK constraint (line ~112) to
  `('sale','giveaway','bonus','tip','other','payout')`.

### 3. Migration — `migrate()` in `src/lib/db/connection.ts` (idempotent)
SQLite cannot `ALTER` a CHECK constraint, so:
1. Detect the old constraint (e.g. inspect `sqlite_master.sql` for
   `ledger_transactions` and check whether `'payout'` is already present). If
   present, skip — the migration is a no-op.
2. Rebuild `ledger_transactions` via the standard 12-step copy (create new
   table with the widened CHECK + same columns/UNIQUE `dedup_key`/FK to
   `shows`, `INSERT INTO new SELECT * FROM old`, drop old, rename).
3. `UPDATE ledger_transactions SET kind='payout' WHERE txn_type='PAYOUT'`.
4. Recompute every show:
   `UPDATE shows SET payout_cents = (SELECT COALESCE(SUM(amount_cents),0)
   FROM ledger_transactions WHERE show_id = shows.id AND kind <> 'payout')`
   for shows with `source_hash='ledger'`.

The detection guard (step 1) makes the whole migration safe to run on every
boot and on already-migrated DBs.

### 4. Payout sums exclude `payout`
- `src/lib/db/ledger.ts` (~line 51): the per-show recompute after import becomes
  `SUM(amount_cents) ... WHERE show_id = ? AND kind <> 'payout'`.
- `src/lib/calc/ledger-report.ts`: in the per-show loop, do **not** add
  `payout`-kind rows to the `payout` accumulator. Instead accrue them into a
  new `withdrawnToBankCents` figure (sum of payout-kind `amountCents`).
  Surface `withdrawnToBankCents` in the report `totals`.

### 5. Surfacing
- `src/lib/csv/ledger-preview.ts`: count `payout` rows so the import screen
  reflects them (a `payoutCount` alongside the existing counts).
- Dashboard (`src/lib/calc/dashboard.ts` + the dashboard page): add a
  **"Paid to bank"** figure sourced from `withdrawnToBankCents`, shown
  separately from profit. Displayed as the absolute amount withdrawn (PAYOUT
  amounts are negative in the ledger; present as a positive "paid to bank"
  total).

## Data flow

```
CSV row (txn_type=PAYOUT)
  → parseLedger → kind='payout'
  → saveLedger: stored in ledger_transactions; show payout_cents recompute EXCLUDES it
  → buildLedgerReport: excluded from payoutCents; summed into withdrawnToBankCents
  → dashboard: shows "Paid to bank" = Σ payout-kind amounts
```

Existing already-imported PAYOUT rows are corrected by the one-time migration.

## Testing (Vitest)

- `classify("PAYOUT", "")` → `"payout"`; existing classifications unchanged.
- `buildLedgerReport`: a show containing a PAYOUT row reports `payoutCents`
  WITHOUT the withdrawal, and `withdrawnToBankCents` equal to the withdrawal.
- Migration: seed a DB in the **old** format (PAYOUT row stored as `other`,
  show payout including it), run `migrate()`, assert the row is reclassified to
  `payout` and the show's `payout_cents` no longer includes it. Running
  `migrate()` again is a no-op.
- `ledger-preview`: a PAYOUT row increments `payoutCount`.

## Risks

- Table rebuild on a live DB — mitigated by doing it inside the existing
  `migrate()` transaction path and guarding on constraint detection so it runs
  exactly once.
- Other withdrawal `txn_type`s (e.g. `TRANSFER`) are unconfirmed; only `PAYOUT`
  exists in current data, so classify only `PAYOUT` for now. Extending is a
  one-line change if another type appears.
