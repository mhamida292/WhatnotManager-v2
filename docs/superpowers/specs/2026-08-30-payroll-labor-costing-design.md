# Payroll as a Show Cost — Design

**Status:** Approved by user, ready for implementation planning.
**Date:** 2026-08-30

## Context

The app tracks wages on `/payroll` but they affect nothing. `buildLedgerReport`
computes `netCents = payout − COGS − giveawayCost − shippingSupplies`
(`src/lib/calc/ledger-report.ts:202`); labor appears nowhere in it, nor on the
dashboard. Of the four things a show costs, three are already subtracted —
inventory, giveaway merchandise, and shipping supplies. Labor is the only one
missing, so every show reads more profitable than it was.

The payroll page is also unreachable (absent from `Nav.tsx`), has no edit path
(`updatePayroll` exists and is tested but no route calls it), and cannot record
a flat payment — `PayrollForm` always posts `hours × rate`, and
`payrollAmountCents` returns `0` when either is blank, so a wage with no hours
silently saves as **$0**.

Hours are the wrong input anyway. The user wants to log a shift the way it
happens: a person, a day, a clock-in and a clock-out.

## Goals

- Every show's net reflects the wages paid for the day it ran.
- Logging a shift means entering times, never a computed hour count.
- Payroll is reachable, editable, and cannot silently save a $0 entry.

## Non-goals

- The 80/20 owner/partner split. The user has retired the arrangement
  entirely; removing `splitProfit`, the `ownerSharePct` setting, and the
  Owner/Partner cards is **its own spec, immediately after this one**. This
  design neither depends on nor preserves the split — it simply leaves it
  alone. Note that show nets drop once labor is subtracted, so the split
  figures will shift before that spec lands. Expected, and short-lived.
- Employee records with saved per-person rates (the open "Partner / employee
  entity" idea in `docs/feature-ideas.md`). Rate stays a field on each shift.
- Manual per-show overrides of how a day's labor divides between sessions.
- Flat payments with no times (bonuses, one-off amounts). See Known Gap below.
- Expenses. They also sit outside net, but the user scoped this to labor.

## Decisions

Settled during the brainstorm; recorded here because each rules out an
alternative someone will otherwise re-propose:

1. **Labor lands in per-show net**, not in a separate business-level total.
   It is a cost of the show, like COGS.
2. **Attribution is by work day.** Wages dated July 8 charge shows dated
   July 8. Not by pay period, and not by picking a show by hand.
3. **A day's wages split evenly across that day's sessions.** No manual
   override. Wages on a day are fungible; giveaway-style allocation
   machinery buys control nobody asked for.
4. **A shift is a date plus two clock times.** Hours are derived, never typed.
5. **An end time strictly before the start means the shift crossed midnight**,
   and the whole shift belongs to the start date — the date the show is on.
   An end time *equal* to the start is a typo, not a 24-hour shift.
6. **Rate is entered per shift.** No stored per-person default.
7. **Wages on a date with no show are surfaced, not dropped.** Non-show
   workdays aren't happening yet, so this is a reporting guarantee rather
   than a feature.

## Data model

There is **no payroll data in any workspace** (confirmed with the user; seeds
never create payroll rows), so the table is reshaped rather than migrated.

Fresh schema in `src/lib/db/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS payroll_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  work_date TEXT NOT NULL,         -- 'YYYY-MM-DD', the day the shift started
  start_time TEXT NOT NULL,        -- 'HH:MM', 24-hour
  end_time TEXT NOT NULL,          -- 'HH:MM', 24-hour
  hours REAL NOT NULL,             -- derived from the times, stored for display
  rate_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,   -- round(hours * rate_cents)
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_work_date ON payroll_entries(work_date);
```

`period_start` and `period_end` are gone. `hours` and `amount_cents` become
`NOT NULL` and are always derived — no entry can exist without both.

**Migration** (`migrate()` in `src/lib/db/connection.ts`), idempotent like every
other migration there. Because `ALTER TABLE ADD COLUMN ... NOT NULL` requires a
default SQLite cannot supply here, the table is recreated rather than altered:

- If `payroll_entries` has the old shape and **zero rows**, drop and recreate it
  from the new schema.
- If it has the old shape and **any rows**, rename it to
  `payroll_entries_legacy` and create the new table empty.

Renaming rather than dropping means a workspace that turns out to hold data —
contrary to what we found — loses nothing and can be inspected by hand. Failing
the boot instead would take the whole app down over payroll.

The bundled SQLite is 3.53.1, so `DROP COLUMN` is available; recreation is still
preferred for the `NOT NULL` columns.

`Settings` is untouched. `payroll_entries` is already listed in
`src/lib/backup/workbook.ts:18`, and the column-drift tolerance added in
`ff0f8a1` absorbs the reshape with no backup-specific work.

## Calculation

Two pure functions, each ignorant of the other's domain, both in
`src/lib/calc/`. This is the same split the codebase already uses — clocks and
money don't belong in one module.

### `shiftHours(start, end): number | null`

Added to `src/lib/calc/payroll-amount.ts` alongside the existing
`payrollAmountCents`, which stays as-is — the module keeps its name and gains
the clock arithmetic.

- Parses `'HH:MM'` to minutes. Malformed input returns `null`.
- `end > start` → same-day shift.
- `end < start` → crossed midnight; add 24 hours.
- `end === start` → `0`, **not** 24 hours. A zero-length shift is a typo, and
  the API rejects it; silently reading it as a full day would be worse than
  refusing it.
- Returns hours as a float (`8:00 PM → 1:00 AM` = `5`).

`payrollAmountCents(hours, rateCents)` survives with its current signature and
rounding, now fed derived hours.

### `allocateLabor(entries, shows): LaborAllocation`

New module `src/lib/calc/labor-allocation.ts`.

```ts
interface LaborAllocation {
  byShowId: Map<number, number>;   // show id -> labor cents
  unallocatedCents: number;        // wages on dates with no show
}
```

- Groups entries by `work_date`, summing `amount_cents`.
- Finds shows whose `show_date` equals that date.
- No show that date → the day's total joins `unallocatedCents`.
- One show → it takes the full amount.
- *n* shows (same-day sessions) → `floor(total / n)` each, with the remainder
  cents going to the **lowest `session_seq`**, mirroring how `splitProfit`
  gives the floor to one party and the remainder to the other rather than
  losing a cent to rounding.

Takes plain arrays, touches no database, and is testable without fixtures.

### Report integration

`buildLedgerReport` calls `allocateLabor` once, then:

- `ShowReport` gains `laborCents`.
- `netCents` becomes
  `payout − cogsCents − giveawayCostCents − shippingSuppliesCents − laborCents`.
- `totals` gains `laborCents` (sum across shows) and `unallocatedLaborCents`.

**`unallocatedLaborCents` is reported but not subtracted from any net.** It
belongs to no show, and inventing a business-level net to absorb it would
contradict decision 1. It exists to make stranded wages visible.

Labor resolves live at report time, like COGS through the alias map — nothing
is stored per show. Editing a shift reflows every report; deleting a show
orphans nothing.

`dashboardSummary` gains `totalLaborCents` and `unallocatedLaborCents`.

## UI

- **`Nav.tsx`** — add `["/payroll", "Payroll"]` to `baseLinks`.
- **`PayrollForm`** — person, date, start, end (`<input type="time">`), rate,
  note. Live-computed hours and amount shown read-only as the user types.
  Submit disabled while hours are `null` or `0`.
- **`PayrollTable`** — columns become date, person, start–end, hours, rate,
  amount, note. Gains an edit affordance alongside the existing delete.
- **`/payroll` page** — existing total and by-person cards stay; the month
  filter keeps working against `work_date` instead of the period columns.
- **Show detail (`/shows/[id]`)** — a labor line beside the COGS and giveaway
  lines already shown.
- **Dashboard and `/report`** — a wages total, plus an unallocated-labor figure
  displayed **only when non-zero**, so it stays invisible until it matters.

## API

- **`POST /api/payroll`** — validates `person` non-empty, `work_date` present,
  `start_time`/`end_time` parseable, resulting hours `> 0`, and `rate_cents`
  a positive integer. Computes `hours` and `amount_cents` server-side; a
  client-supplied amount is ignored. Returns `400` with a message on any
  failure. This is what kills the silent-$0 bug: the amount is no longer the
  client's to assert.
- **`PATCH /api/payroll/[id]`** — new, wiring up the existing `updatePayroll`.
  Same validation as POST.
- **`DELETE /api/payroll/[id]`** — unchanged.
- **`GET /api/payroll`** — accepts the same date range the page uses, rather
  than always returning everything as it does today.

All routes keep calling `dbForRequest()`. `middleware.ts` only checks that a
cookie exists, so per-route auth is the real gate — the new PATCH route must
not skip it.

## Error handling

| Situation | Behavior |
|---|---|
| End time equals start time | Rejected, `400`. Never read as 24 hours. |
| End before start | Valid — crossed midnight, belongs to the start date. |
| Malformed time | `shiftHours` returns `null`; API rejects. |
| Rate zero or negative | Rejected. |
| Wages on a date with no show | Counted in `unallocatedLaborCents`, visible. |
| Two sessions, odd cent | Remainder to the lowest `session_seq`. |
| Legacy rows found at migration | Table renamed, not dropped. |

## Testing

Following `tests/lib/calc/` and `tests/api/`:

**`shiftHours`** — same-day span; midnight wrap (`20:00 → 01:00` = 5);
equal times = 0, not 24; malformed input; one-minute shift.

**`allocateLabor`** — single show takes the full amount; two sessions split
evenly; odd cent goes to the lower `session_seq`; a date with no show lands in
`unallocatedCents`; multiple people on one date sum before splitting; empty
input.

**`buildLedgerReport`** — a show's `netCents` drops by exactly the day's wages;
totals carry `laborCents`; unallocated wages do **not** reduce any net.

**API** — POST rejects equal start/end, malformed times, and non-positive
rate; POST ignores a client-supplied `amountCents` and recomputes it; PATCH
updates and re-derives; PATCH requires auth.

**Migration** — an old-shape table with zero rows is recreated; one with rows
is preserved as `payroll_entries_legacy`.

## Known gap

**Flat payments have no home.** Every entry requires times and a rate, so a
bonus or a one-off "here's $100" cannot be recorded. The user chose per-shift
rates over a dual-path form, and accepted this. Today's form is worse (it saves
$0 silently), so this is an improvement, not a regression — but if flat
payments start happening, the fix is an optional amount path that skips the
clock, not a redesign.

## Files touched

```
src/lib/db/schema.ts              payroll_entries reshape
src/lib/db/connection.ts          migrate(): recreate or rename
src/lib/db/payroll.ts             PayrollRow, insert/update/list on new columns
src/lib/calc/payroll-amount.ts    -> shiftHours + payrollAmountCents
src/lib/calc/labor-allocation.ts  new
src/lib/calc/ledger-report.ts     laborCents per show + totals; netCents
src/lib/calc/dashboard.ts         totalLaborCents, unallocatedLaborCents
src/app/api/payroll/route.ts      validation, server-side amount, range on GET
src/app/api/payroll/[id]/route.ts PATCH
src/components/payroll/*          form, table
src/app/payroll/page.tsx          work_date filtering
src/app/shows/[id]/page.tsx       labor line
src/components/Nav.tsx            Payroll link
docs/calculations.md              document the new subtraction
```

## Follow-ups

1. **Retire the 80/20 split** — the next spec.
2. Flat payments, if they start happening.
3. Per-person saved rates, if entry becomes tedious.
4. Compare hours worked against a show's `timeRange`, which
   `buildLedgerReport` already derives from ledger timestamps.
