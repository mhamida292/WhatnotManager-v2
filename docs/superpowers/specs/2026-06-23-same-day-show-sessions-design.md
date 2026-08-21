# Same-Day Show Sessions — Design

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with the user

## Problem

The Whatnot ledger import groups transactions into shows by **calendar date only**
(`ledgerShowDate` strips the time; `saveLedger` keys a show by `show_date` + `source_hash='ledger'`).
When the user runs two (or more) streams on the same day, all their transactions collapse into one
show — so the two shows share a single P&L, giveaway allocation, shipping figure, and owner/partner
split. The user wants each stream tracked as its own show.

## Goals

- Split a day's ledger transactions into separate shows automatically, with no manual UI.
- Each resulting show is a fully independent show: its own P&L, giveaways, shipping, bundles, and split.
- Support 2+ shows per day.
- Existing (already-imported) two-in-a-day dates split retroactively.

## Non-Goals

- No manual split UI and no manual merge/override. The user confirmed a single stream never goes
  more than an hour without a sale, so the automatic rule is reliable (no false splits to correct).
- No change to legacy, manually-uploaded shows (`source_hash != 'ledger'`).
- The gap threshold is a fixed constant, not a user setting (YAGNI).

## Key Design Decisions

1. **Automatic split by time gap, driven by SALES only.** Session boundaries are computed from
   **sale-kind transactions only**: within one date, sales are ordered by time and a new session
   begins wherever the gap between consecutive **sales** is **more than 60 minutes** (exactly 60
   stays together). Threshold constant: `SESSION_GAP_MINUTES = 60`. Non-sale rows (fees/"other"
   adjustments, giveaway deductions, tips, bonuses, and bank **withdrawals/payouts**) do NOT define
   boundaries — they are each attached to the session whose time window contains them, or the
   nearest session otherwise. This prevents stray account activity at odd hours (e.g. an early-morning
   fee or a midday bank withdrawal) from spawning phantom "shows" separate from the real stream.
   A date with no sales at all stays a single show (session 0).

2. **A show is identified by (date, session_seq).** `session_seq` is a 0-based ordinal per date
   (0 = first stream of the day, 1 = second, …), ordered by time. Single-session days keep
   `session_seq = 0` and behave exactly as today.

3. **Grouping is recomputed deterministically from all of a date's transactions.** Session
   assignment is a pure function of the transaction timestamps, so it is stable and self-correcting
   across re-imports — given the same transactions, it always produces the same grouping.

4. **Time parsing stays timezone-safe.** A new parser reads only the time-of-day (seconds since
   midnight) from the raw `Created Date` string, mirroring `ledgerShowDate`'s no-`Date` approach.
   Seconds-of-day is sufficient because sessions are only ever compared within a single date.

## Data Model

One new column (added via the existing `migrate()` ALTER pattern, since SQLite has no
`ADD COLUMN IF NOT EXISTS`):

```sql
ALTER TABLE shows ADD COLUMN session_seq INTEGER NOT NULL DEFAULT 0;
```

- Existing rows default to `session_seq = 0`.
- Show identity for ledger shows becomes `(show_date, session_seq)`.

## Components / Modules

### `src/lib/calc/sessions.ts` (new, pure)
- `export const SESSION_GAP_MINUTES = 60;`
- `sessionizeByGap(timesInSeconds: number[], gapSeconds: number): number[]`
  — input is **sale** times **already sorted ascending**; returns the 0-based session index for each,
  incrementing whenever `times[i] - times[i-1] > gapSeconds`. Pure building block.
- `assignSessions(items: { timeSeconds: number; isSale: boolean }[], gapSeconds: number): number[]`
  — computes session boundaries from the sale items only, builds each session's `[minSaleTime,
  maxSaleTime]` window, then returns the session index for **every** item: the window that contains
  its time, or the nearest window by time distance (ties → earlier session). If there are no sale
  items, returns all `0` (single session). Pure and isolated.

### `src/lib/csv/ledger.ts` (modified)
- `export function ledgerTimeOfDaySeconds(createdDate: string): number`
  — parses `", H:MM:SS AM/PM"` out of e.g. `"Jun 12, 2026, 5:02:11 PM"` → seconds since midnight
  (12 AM → 0, 12 PM → 12:00). Returns `0` on parse failure (rare; sorts first). No `Date` used.
- `LedgerRow` gains `timeSeconds: number` (from `ledgerTimeOfDaySeconds(createdAt)`), used for
  ordering and gap computation at import.

### `src/lib/db/ledger.ts` (modified)
- New `regroupLedgerShows(db, showDate: string): void`:
  1. Load all `source_hash='ledger'` transactions for the date (id, `created_at`, `kind`).
  2. Compute the session index for every transaction with `assignSessions(items, ...)` where
     `items[i] = { timeSeconds: ledgerTimeOfDaySeconds(created_at), isSale: kind === 'sale' }`
     — sales drive the boundaries; non-sales attach to the containing/nearest session.
  3. Ensure exactly N ledger-show rows exist for the date (N = session count): reuse existing rows
     ordered by `session_seq`, create missing ones, delete any ledger show for the date that ends up
     with zero transactions.
  4. Reassign each transaction's `show_id` to the show whose `session_seq` matches its session.
  5. Recompute each affected show's `payout_cents` (existing rule: SUM of amounts where `kind <> 'payout'`).
- `saveLedger` calls `regroupLedgerShows(db, date)` for each touched date after inserting (replacing
  the date-only `findOrCreateShow` grouping as the source of show assignment).

### `src/lib/db/connection.ts` (modified)
- In `migrate()`: add the `session_seq` column if absent; **when newly added**, run a one-time
  backfill calling `regroupLedgerShows` for every distinct existing ledger `show_date`, so past
  two-in-a-day dates split. Guarded by the column-absent check so it runs once.

### `src/lib/db/shows.ts` (modified)
- `ShowRow` gains `sessionSeq`. `listShows` selects it and orders `show_date DESC, session_seq ASC`.

### `src/lib/calc/ledger-report.ts` (modified)
- `ReportShow` gains `sessionSeq: number` and a derived `timeRange` (min/max transaction
  time-of-day for the show, formatted e.g. `"5:02–7:30 PM"`) plus a `dateHasMultipleSessions` flag
  (true when the date has >1 ledger show), for labeling.

### Display (modified)
- `src/app/report/page.tsx`, `src/app/shows/[id]/page.tsx`, and the dashboard: when a date has more
  than one session, show a tag like **"Show 2 · 5:02–7:30 PM"** next to the date; single-session days
  render unchanged.

## Data Flow

1. User imports the ledger (existing flow). Transactions are inserted (idempotent via `dedup_key`).
2. For each touched date, `regroupLedgerShows` derives sessions from all that date's transactions and
   assigns each to the correct (date, session_seq) show, creating/removing show rows as needed.
3. Reports, show pages, and the dashboard now list each session as its own show, labeled by time when
   a date has more than one.

## Error Handling & Edge Cases

- **Exactly 60-minute gap** → same show (`>` comparison).
- **Single-session day** → `session_seq = 0`, behavior identical to today.
- **Bundles** key off `ledger_txn_id`, so they follow their transaction into the correct session automatically.
- **Per-show user data** (giveaway allocations, shipping supplies) is keyed by `show_id`, mapped by
  session ordinal. A later re-import that changes a date's session count could shift these; documented
  constraint: enter giveaways/shipping after the final import for a date. (Normal flow imports once per show.)
- **Unparseable `created_at`** → `timeSeconds = 0`, sorts first; does not crash grouping.
- **`payout`-kind transactions** (bank withdrawals) are sessionized like any other by their time.
- **Legacy non-ledger shows** are never touched by `regroupLedgerShows`.

## Testing

Follow existing Vitest patterns.
- `sessionizeByGap`: 1 session (no gaps), 2 and 3 sessions, boundary at exactly 60 vs 61 minutes,
  empty input.
- `ledgerTimeOfDaySeconds`: AM/PM, 12:00 AM (0) and 12:00 PM (43200), parse failure → 0.
- `saveLedger` / `regroupLedgerShows`: a CSV with a >60-min gap in one day → two show rows with the
  correct transaction split and per-show payouts; a day with only sub-60-min gaps → one show;
  re-importing the same file is idempotent and preserves grouping; a third session works.
- `buildLedgerReport`: multiple shows per date carry distinct `sessionSeq` and time ranges; totals
  unchanged in aggregate.
- Migration/backfill: an existing single-show two-in-a-day date splits into two after the column is added.

## Out of Scope / Future

- Manual override of the automatic boundary (merge/split by hand).
- Configurable gap threshold.
