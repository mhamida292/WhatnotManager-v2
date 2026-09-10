# Piece-rate payroll — design

**Date:** 2026-09-10
**Status:** approved for planning

## Problem

Payroll only records hourly shifts. `payroll_entries` requires `start_time`,
`end_time`, `hours` and `rate_cents`, and `parseShiftInput` rejects anything
without valid clock times. Work that is paid by output — so many pieces
processed, so many packages shipped — cannot be logged at all, and nothing
anywhere records what has actually been handed over, so "what do I owe him?"
lives outside the app.

## Goals

1. Log work on any of three bases — **hour**, **piece**, **package** — chosen
   per entry, with the rate chosen per entry too.
2. Pre-fill the rate from a saved default per person per basis, overridable on
   any entry.
3. Mark an entry paid (or not) and show what is still owed, per person and in
   total.
4. Leave labor allocation, the dashboard and net profit working exactly as they
   do now, with piece and package pay flowing through them.

## Non-goals

- Counting pieces or packages automatically from `show_line_items`,
  `item_purchases` or `ledger_transactions`. Every quantity is hand-entered.
- Partial payments against a single entry. An entry is paid or it is not.
- Changing how non-show-day wages are allocated (see Decisions).
- Sub-cent rates (see Open risk).

## Decisions

**Paid tracking is a flag on the entry, not a payment ledger.** Each entry
carries a nullable `paid_on`; owed is the sum of entries where it is null. A
cash payment that does not line up with entry boundaries is resolved by the
user choosing which entries to mark, not by the app splitting one.

**Paid/unpaid never touches profit.** An entry costs the business on the day
the work was done, not the day the cash moved. Allocation and the dashboard
ignore `paid_on` entirely.

**Non-show-day wages stay unallocated.** `allocateLabor` charges a day's wages
to that day's shows and reports wages on show-less dates as
`unallocatedCents`, outside every show's net. Piece work on a no-show day (a
lot intake on a Tuesday) will land there. This is existing behavior and is kept
deliberately: it is visible on the dashboard rather than silently spread. It
may be revisited once the number is observed in practice.

## Data model

### `payroll_entries` (reshaped)

| column | change |
| --- | --- |
| `basis` | **new** — `TEXT NOT NULL DEFAULT 'hour' CHECK (basis IN ('hour','piece','package'))` |
| `qty` | **new** — `REAL NOT NULL`. Hours for `hour`; a whole count for `piece`/`package` |
| `hours` | **dropped** — values move into `qty` |
| `start_time`, `end_time` | **relaxed to nullable** — only `hour` entries have them |
| `rate_cents` | unchanged — cents per hour, per piece, or per package, per `basis` |
| `amount_cents` | unchanged — always `round(qty × rate_cents)`, derived server-side |
| `paid_on` | **new** — `TEXT` nullable; null means owed |
| `person`, `work_date`, `note` | unchanged |

The index on `work_date` is unchanged.

### `payroll_rates` (new)

```sql
CREATE TABLE IF NOT EXISTS payroll_rates (
  person TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('hour','piece','package')),
  rate_cents INTEGER NOT NULL,
  PRIMARY KEY (person, basis)
);
```

Defaults only. Nothing reads it at report time; it exists to pre-fill the form.

### Migration

SQLite cannot drop a `NOT NULL` or a column in place, so this is a
rebuild-and-copy in the shape of the existing `migratePayrollShifts`:

- Guard on the presence of the `hours` column, so it runs exactly once.
- Update `PAYROLL_SCHEMA` to the new DDL, so a fresh database and a migrated one
  are created from the same source.
- In one transaction: rename the old table aside, create the new one from
  `PAYROLL_SCHEMA`, copy every row across with `basis='hour'`,
  `qty=hours`, `paid_on=NULL`, then drop the renamed table. Unlike the earlier
  payroll migration this one has a lossless mapping for every column, so the
  old table is dropped rather than left on disk.
- Recreate `idx_payroll_work_date` after the reshape, as `migrate()` already
  does.

### Backup/restore

`src/lib/backup/workbook.ts` derives its column lists from the live schema and
tolerates drift, so most of this is automatic. Two edits are required:

- Add `hours: "qty"` to `RENAMED_COLUMNS.payroll_entries`, so an older
  workbook's hours carry across instead of being dropped as unknown and the
  `NOT NULL qty` refilled with a `0` placeholder.
- Add `payroll_rates` to `TABLES`. It has no foreign keys, so it can sit
  beside `payroll_entries`.

## Behavior

### Validation

`parseShiftInput` becomes `parsePayrollInput`, branching on `basis`. Shared
across all three: person required, `work_date` matching `YYYY-MM-DD`,
`rate_cents` a positive integer. Then:

- **`hour`** — unchanged from today. `start_time`/`end_time` required and
  well-formed; `qty` derived by `shiftHours`, including the midnight-crossing
  rule and the equal-times-is-zero rule; rejected if not greater than zero.
- **`piece` / `package`** — `start_time`/`end_time` absent (stored null); `qty`
  a whole number greater than zero. A fractional count is a typo, not a half
  piece, so it is rejected rather than rounded.

`amount_cents` stays derived server-side in every case — the client never
asserts it. `payrollAmountCents(qty, rateCents)` needs no change; only its
parameter name and doc comment become basis-neutral.

`paid_on`, when supplied, must match `YYYY-MM-DD` or be null.

### Allocation and the dashboard

No change. `ledger-report.ts` maps every payroll row to
`{ workDate, amountCents }` before calling `allocateLabor`, which is already
blind to basis. A piece entry dated 2026-09-09 is charged to that date's shows
and split across same-day sessions exactly like a shift. Existing
`allocateLabor` tests must pass untouched — that is the check that this change
did not disturb net profit.

### API

`POST /api/payroll` and `PATCH /api/payroll/:id` accept the new fields through
`parsePayrollInput`. Marking paid rides on the existing `PATCH` rather than a
new endpoint.

## UI

All of this is on the existing Payroll page.

**Header stats.** The existing total gains a **Still owed** stat beside it —
the sum of entries with `paid_on IS NULL` in the selected range. The By person
card gains an owed figure per person next to the earned figure.

**Table.** Two new columns, **Basis** (a pill: hour / piece / package) and
**Work**, which renders `5.50 hrs` with the clock times for hourly rows and
`300 pieces` / `120 packages` for the others — replacing today's separate
Shift and Hours columns. A **Paid** column shows the paid date or an unpaid
marker; clicking stamps today's date, clicking again clears it. Inline editing
follows the same basis branch as the form.

**Form.** A Hour / Piece / Package toggle at the top. Hourly shows the existing
start and end time inputs; piece and package replace them with a single count
field labelled "Pieces" or "Packages". Choosing a person pre-fills that
person's saved rate for the current basis, still editable. The live amount
preview stays.

**Rates card.** A small section on the Payroll page listing each person's three
defaults, editable in place. Copy makes clear these only pre-fill the form.

## Testing

- `parsePayrollInput` per basis: hourly still derives hours and still handles a
  shift crossing midnight; piece and package reject zero, negative and
  fractional counts; every basis rejects a zero or negative rate; the client's
  claimed amount is ignored in favor of the derived one.
- Amount rounding at the half cent (e.g. 333 pieces at 15¢).
- `payroll_rates` read/write, including overwrite of an existing person+basis.
- Paid toggle: setting and clearing `paid_on`; owed totals per person and
  overall, and that they respect the date-range filter.
- Migration: an old-shape table with rows lands as `basis='hour'` with `qty`
  equal to the old `hours` and null `paid_on`; running it twice is a no-op.
- Backup round-trip: export and re-import preserves basis, qty, paid_on and the
  rates table; an older workbook's `hours` column arrives as `qty`.
- Existing `allocateLabor` and ledger-report tests pass unchanged.

## Files touched

- `src/lib/db/schema.ts` — `PAYROLL_SCHEMA`, `payroll_rates`
- `src/lib/db/connection.ts` — new migration, called from `migrate()`
- `src/lib/db/payroll.ts` — columns, `paid_on`, owed totals, rates CRUD
- `src/lib/calc/payroll-amount.ts` — `parsePayrollInput`
- `src/lib/backup/workbook.ts` — `TABLES`, `RENAMED_COLUMNS`
- `src/app/api/payroll/route.ts`, `src/app/api/payroll/[id]/route.ts`
- `src/app/payroll/page.tsx` — owed stat, rates card
- `src/components/payroll/PayrollForm.tsx`, `PayrollTable.tsx`
- new `src/components/payroll/PayrollRates.tsx`
- tests under `tests/`

## Open risk

`rate_cents` is a whole number of cents, so `$0.15/piece` is exact but
`$0.075/piece` is not expressible. If sub-penny piece rates are ever needed the
column has to widen (millicents, or a rate stored per hundred pieces), and
retrofitting that after entries exist is unpleasant. Flagged and accepted for
now.
