# Legacy Excel Import — Design

**Date:** 2026-07-27
**Status:** Approved (pending spec review)

## Context

The owner runs two deployments of the same lineage:

- **wh.momajlab.com** — the older *whatnot-business-manager* app, which holds the real
  data (68 inventory items, 4,859 ledger rows, 74 Whatnot name mappings).
- **warehouse.momajlab.com** — this app, feature-complete but with a nearly empty
  workspace (`dbForRequest()` serves the single shared `data/ws/0.db`).

They want to consolidate onto this app by exporting Excel from the old one and
importing it here. **Today that is impossible:** `importWorkbook` iterates this
app's `TABLES` and throws on the first missing sheet — a legacy export has no
`inventory_moves`, `item_identifiers`, or `payroll_entries` sheet, carries two
tables that no longer exist (`product_aliases`, `brother_transactions`), and
nearly every shared table has since gained columns.

**Verified alternative, for context:** handing a legacy `.db` file straight to
`createDb` upgrades it perfectly — all 4,859 ledger rows preserved, all 74
aliases converted to `whatnot` identifiers, all 68 items assigned SKUs. The
owner chose the Excel route anyway because it works through the browser on both
servers with no file access. This design reuses that proven upgrade path rather
than reimplementing conversion logic.

## Goals

1. A legacy Excel backup imports successfully into this app.
2. Whatnot name mappings survive as `item_identifiers` rows with source `whatnot`.
3. Current-format backups keep importing through the existing strict path,
   behavior unchanged.
4. A failure leaves the destination workspace exactly as it was.

## Out of Scope

- **Merging** with existing data. Import stays replace-all (owner's decision).
  Every table uses autoincrement ids that would collide; merging is its own project.
- Changing the old app. All work is here.
- Migrating user accounts — `users.db` is separate and unaffected.

## Design

### 1. Detection

Both apps write the same `_meta` marker (`whatnot-business-manager`), so the
existing marker check passes unchanged and needs no edit.

The `_meta` sheet also carries a `tables` row: the comma-joined table list the
file was written with. Parse it. The file takes the **legacy path** when that
list differs from the current `TABLES` — in practice when it contains
`product_aliases` or lacks `inventory_moves`. Otherwise the current strict path
runs exactly as today.

Detection reads `_meta` only, so a corrupt or foreign file still fails on the
existing marker check with the existing message.

### 2. The legacy import

All steps run inside **one** `db.transaction`, on the destination workspace DB:

1. **Wipe** every current table in reverse FK order — identical to the strict path.
2. If the workbook has a `product_aliases` sheet, recreate that legacy table:
   ```sql
   CREATE TABLE IF NOT EXISTS product_aliases (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     product_name TEXT NOT NULL UNIQUE,
     item_id INTEGER NOT NULL REFERENCES inventory_items(id)
   );
   ```
3. **Insert** each sheet's rows, walking the tables in the order the file's own
   `_meta` list gives (that order is FK-safe for the schema that wrote it):
   - Insert only columns that exist in the destination table; ignore any column
     the schema has since dropped.
   - Skip sheets whose table does not exist here and is not staged in step 2 —
     `brother_transactions` is skipped entirely.
   - Leave tables with no corresponding sheet empty (`inventory_moves`,
     `payroll_entries`, `item_identifiers`).
4. Call **`migrate(db)`**. This is the whole trick — it already:
   - assigns `ITEM-00001`-style SKUs to items lacking one,
   - inserts a `mine` identifier per item,
   - converts `product_aliases` → `item_identifiers` source `whatnot`,
   - **aborts** if two aliases would collide on `UNIQUE(code)`, rather than
     silently dropping rows,
   - drops `product_aliases` when done,
   - drops `brother_transactions` if present.

No new conversion logic is written. Step 4 is the identical code path verified
against the real database.

### 3. Safety

- **Atomic.** One transaction. Any throw — including the alias-collision abort —
  rolls back, leaving the workspace byte-identical to before the attempt.
- **Informed destruction.** Before anything is deleted, the UI states what will
  be destroyed using live counts from the destination, e.g. *"This will
  permanently delete the 68 items, 16 invoices and 4,859 ledger rows currently in
  this workspace and replace them with the file's contents."* The user must
  confirm. This applies to **both** import paths, not just the legacy one — the
  strict path is equally destructive and its existing confirm
  (`BackupRestore.tsx:20`) is generic — it names nothing about what is about to
  be lost.
- **Honest reporting.** On success, report per-table row counts inserted, plus an
  explicit note of what was not carried across (see §4).

### 4. What does not come across

Stated in the UI after a legacy import, not buried:

- **Brother transactions** — the concept was removed from this app; the sheet is skipped.
- **Any column dropped since the file was written.**
- `inventory_moves`, `payroll_entries`, `item_identifiers` beyond the converted
  aliases and generated SKUs, start empty.
- Whatnot-only mode starts **off**.

## Testing

- A fixture workbook built in the **legacy shape** — legacy `_meta` table list,
  a `product_aliases` sheet, a `brother_transactions` sheet, no `inventory_moves`
  — imports successfully; assert row counts preserved per table, aliases became
  `whatnot` identifiers, every item got a SKU and a `mine` identifier, and
  `brother_transactions` was skipped.
- A legacy file whose shared tables are missing columns this app added still
  imports, with those columns taking their schema defaults.
- A **current-format** workbook still round-trips through the strict path
  (existing test must keep passing unmodified).
- A legacy file with two aliases colliding on one code **rolls back**: the import
  throws a `BackupError` naming the collision and the destination workspace is
  unchanged (assert its row counts match the pre-import values).
- A file with a bad/missing `_meta` marker still fails with the existing message.

Verify with `npm test` and `npm run build`, then smoke on a dev copy: export from
the old app, import here, confirm inventory, ledger, shows and the Whatnot name
mappings all appear.

## Risks

- **Replace-all is destructive and now reachable with an old file.** Mitigated by
  the pre-import confirmation showing real counts. The owner accepted replace-all
  knowingly; the warning is what makes it safe in practice.
- **The legacy `_meta` order is trusted for FK safety.** It was FK-safe for the
  schema that wrote it. If a future legacy variant ordered tables differently, the
  insert could fail an FK check — which rolls back cleanly rather than corrupting.
- **Column defaults are silent.** A legacy row missing a since-added `NOT NULL`
  column relies on that column's schema default. Tables where a default is absent
  would throw and roll back; the tests must cover at least one such added column.
