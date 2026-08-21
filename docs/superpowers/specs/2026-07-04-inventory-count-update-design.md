# Inventory Count Update — Design

**Date:** 2026-07-04
**Status:** Approved design, pending spec review
**Area:** `/inventory` list + `/inventory/[id]`, new `/inventory/count`, `src/lib/db/inventory.ts`, `src/lib/db/adjustments.ts`, schema.

## Motivation

The user counts physical merchandise periodically and wants that to be easy:
override a count quickly, do a full shelf count, and see a **dated record of how
many pieces they had**. Today the pieces exist but are awkward:

- `qtyRemaining = qty_purchased − qtySold + Σ adjustments`.
- An `inventory_adjustments` log already stores `adjusted_on`, `reason`
  (`sample | damage_loss | recount | other`), `qty` (a **delta**), and `note`.
- `setItemRemaining(db, id, target)` already appends a dated `recount` adjustment
  for the difference — but with no reason choice and no note.
- The log stores only the **delta** (−3), not the **absolute count** the user
  wrote down (40), so it doesn't read like a count history.
- `qty_samples` is a vestigial column: `updateItemSamples` still writes it but it
  no longer affects `qtyRemaining` — it only clutters the display.

## Decisions

### 1. Remove the samples cruft (keep "sample" as a reason)
- Drop the `qty_samples` **display** everywhere it still shows, and remove/retire
  `updateItemSamples` and its call sites (the deprecated setter).
- **Keep `sample` as an adjustment reason**, so a count drop can still be
  explained as "gave as samples" in the history. (User picked Q2 option B.)
- The `qty_samples` column can stay in the table for now (harmless) but is no
  longer read or written; a later cleanup migration may drop it. Not required.

### 2. Count history reads as absolute counts
- Add a nullable **`counted`** column to `inventory_adjustments` (INTEGER).
  For a count/recount, store BOTH the `qty` delta (−3) **and** `counted` (40).
  For non-count adjustments (damage/loss with no physical count), `counted` is
  NULL and the row shows only the change.
- The item page renders a **Count history** table: `Date · Counted · Change ·
  Reason · Note`. When `counted` is present it's the headline ("on Jul 4 I had
  40"); the ± change is shown secondarily. Reuses `listAdjustments`.

### 3. Quick single-item recount (spot check)
- On `/inventory/[id]`: a compact "Quick recount" control — `I counted [N]`,
  a reason dropdown (default `recount`; also `sample`, `damage/loss`, `other`),
  optional note, and a **Set count** button.
- Backed by an extended `setItemRemaining(db, id, target, { reason, note })`:
  computes `delta = target − currentRemaining`, appends one adjustment dated
  today with `qty = delta`, `counted = target`, the chosen `reason`, and `note`.
  Never touches cost/COGS/spend (unchanged guarantee). A zero delta with an
  explicit count still records the count (confirms "counted 40, no change").

### 4. Full count mode (stocktake)
- New page `/inventory/count`: a table of **all items** with `Expected`
  (current `qtyRemaining`), a `Counted` input, an auto `Diff`, and a `Reason`
  select shown when the diff is non-zero.
- **Blank Counted = skip** that item (no adjustment written).
- **Save count** writes, for each filled row, one dated count adjustment
  (`qty = counted − expected`, `counted`, `reason`, dated today) in a single
  transaction. All rows share the same `adjusted_on` date (the session date).
- MVP groups a session purely by shared date — no new `count_session` table.
  (A session id could be added later if per-session review is wanted; out of
  scope now.)

## Data model

```
inventory_adjustments  (existing table, one new column)
  ...existing columns...
  counted   INTEGER  NULL   -- absolute count recorded for count/recount rows
```

- Migration: `ALTER TABLE inventory_adjustments ADD COLUMN counted INTEGER`.
  Existing rows keep `counted = NULL` (they still render via the Change column).
- No change to `qtyRemaining` math — it still sums `qty` deltas, so old and new
  rows behave identically for the running total. `counted` is display/audit only.

## Components / files

- `src/lib/db/adjustments.ts` — `addAdjustment` accepts optional `counted`;
  `Adjustment` type gains `counted: number | null`; `listAdjustments` returns it.
- `src/lib/db/inventory.ts` — extend `setItemRemaining` to take `{ reason, note }`
  and write `counted`; add a batch `applyCount(db, rows)` for the count page
  (transactional). Remove `updateItemSamples` (and its callers) and drop
  `qtySamples` from `ItemRow` / the list query once display is cleaned up.
- `src/app/inventory/[id]/page.tsx` — add Quick recount control + Count history
  table; remove samples display.
- `src/app/inventory/page.tsx` — remove any samples column; add a link/button to
  "Count merchandise" (`/inventory/count`).
- `src/app/inventory/count/page.tsx` — NEW full count-mode page + save action.
- API: extend `/api/inventory/[id]/adjustments` (or the recount endpoint) for the
  reason/note/counted payload; new endpoint for the batch count save.

## Error handling
- Counted inputs reject negatives and non-integers; blank = skip (not zero).
- Reason defaults to `recount`; required only when a diff exists in count mode.
- Batch save is atomic — a bad row fails the whole session with a clear message.

## Testing
- Unit (Vitest, alongside existing adjustments/inventory tests):
  `setItemRemaining` writes `counted` + reason + correct delta; zero-delta count
  still records a row; `applyCount` writes one row per filled item and skips
  blanks, all sharing the session date, in one transaction; `qtyRemaining`
  unchanged by the new column; `listAdjustments` surfaces `counted`.

## Out of scope / deferred
- Dropping the `qty_samples` column itself (retire in use now; migrate later).
- Per-session grouping/review (`count_session` table).
- Editing/deleting individual history rows beyond what exists today.
