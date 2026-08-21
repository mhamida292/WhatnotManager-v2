# Excel full backup & restore — design

**Date:** 2026-06-20

## Problem / use case

The user wants a portable, human-inspectable backup of all their data "in case
something happens," plus a way to restore it. The SQLite file is already a full
backup (and is in git), but an `.xlsx` export is portable off-machine and
doesn't depend on git. This feature exports the entire database to one Excel
workbook and restores the database from such a workbook.

## Goal

- **Export:** download a single `.xlsx` containing every table, raw values, with
  perfect round-trip fidelity.
- **Restore:** upload that `.xlsx` to replace the entire database with its
  contents, atomically, after strict validation and an explicit confirm.

## Non-goals

- No human-friendly/editable views, no per-table partial import, no merge/upsert
  (decided 2026-06-20: full backup & restore only; replace-all semantics).
- No automatic/scheduled backups (manual button only).

## Library

Add **ExcelJS** (`exceljs`) as a dependency — actively maintained, pure-JS
read+write, no native build step. (SheetJS's npm distribution is unreliable.)

## Tables (all 12, in dependency order for insert)

Parents first so FK inserts succeed; reverse for deletes:
`lots`, `inventory_items`, `invoices`, `invoice_lines`, `item_purchases`,
`product_aliases`, `brother_transactions`, `shows`, `show_line_items`,
`ledger_transactions`, `expenses`, `app_settings`.

The canonical ordered table list + each table's column list is derived at
runtime from `PRAGMA table_info(<table>)` (single source of truth — no
hardcoded column lists that can drift from the schema).

## Components

### `src/lib/backup/workbook.ts` (new) — pure-ish DB ↔ workbook logic

- **`TABLES: string[]`** — the ordered table list above (insert order).
- **`exportWorkbook(db): Promise<Buffer>`**
  - For each table in `TABLES`: read columns via `PRAGMA table_info`, add a
    worksheet named exactly as the table, write a header row of column names,
    then one row per record with raw stored values (integers stay integers).
  - Add a `_meta` worksheet with rows: `app = "whatnot-business-manager"`,
    `exportedAt = <ISO>`, `tables = <comma-joined TABLES>`. This marks the file
    as a valid backup.
  - Return the workbook as an `.xlsx` Buffer.
- **`importWorkbook(db, buffer): Promise<{ counts: Record<string, number> }>`**
  - Load the workbook. **Validate (throws `BackupError` on any failure, before
    touching the DB):**
    1. `_meta` sheet exists and `app === "whatnot-business-manager"`.
    2. For every table in `TABLES`, a worksheet of that name exists.
    3. Each table sheet's header columns set-equals the live schema columns from
       `PRAGMA table_info` (order-independent; rejects stale/edited files).
    (Unknown extra sheets are ignored for forward-compat.)
  - **Restore in ONE `db.transaction`:** delete all rows from every table in
    reverse dependency order; then for each table in insert order, insert each
    sheet row mapping header column → value. `app_settings` is included (its
    single row is replaced). Return per-table inserted counts.
  - A single transaction → any failure rolls back; the DB is never left
    partially restored.
- **`class BackupError extends Error`** — thrown for validation failures so the
  API maps it to HTTP 400 with the message.

### API routes

- **`src/app/api/backup/export/route.ts`** — `GET` returns the buffer with
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  and `Content-Disposition: attachment; filename="whatnot-backup-<YYYY-MM-DD>.xlsx"`.
- **`src/app/api/backup/import/route.ts`** — `POST` reads the uploaded file
  (`await req.formData()` → `file.arrayBuffer()`), calls `importWorkbook`,
  returns `{ ok: true, counts }`; on `BackupError` returns `{ error }` 400; other
  errors → 500.

### UI — `src/app/settings/page.tsx` + `src/components/BackupRestore.tsx` (new, client)

A "Backup" card on the Settings page, above or near the existing Danger zone:
- **Export to Excel** — a link/button to `GET /api/backup/export` (browser
  downloads the file).
- **Import / Restore** — a file input (`accept=".xlsx"`) + button. On submit,
  `confirm("Restore from this file? This REPLACES all current data with the
  file's contents and can't be undone.")`; then POST the file as `FormData`. On
  success, show the restored counts and `router.refresh()`; on error, show the
  returned message.

## Data flow

```
Export:  GET /api/backup/export → exportWorkbook(db) → .xlsx download
Restore: choose .xlsx → confirm → POST /api/backup/import (FormData)
         → importWorkbook validates → single-transaction replace-all → {counts}
```

## Error handling

- Invalid/foreign/edited file → `BackupError` → 400, DB untouched.
- Mid-restore failure (e.g. constraint) → transaction rollback → DB untouched →
  500 with message.
- Export is read-only and always safe.

## Testing (Vitest) — `tests/lib/backup/workbook.test.ts`

- **Round-trip (key test):** build a DB with rows across many tables (inventory,
  purchases, a ledger import, shows, expenses, invoices, aliases, settings),
  `exportWorkbook` → `importWorkbook` into a FRESH `createDb(":memory:")` →
  assert each table's full row set equals the source (compare ordered rows).
- **Validation:** importing a workbook with a missing required sheet, mismatched
  columns, or missing/foreign `_meta` throws `BackupError` and leaves the target
  DB unchanged (assert row counts unchanged).
- **Transactional:** a workbook whose rows violate a constraint rolls back
  entirely (no partial data).
- **Empty DB:** `exportWorkbook` on a fresh DB produces a workbook that imports
  back to an empty DB without error.

## Risks

- Column drift: avoided by deriving columns from `PRAGMA table_info` at runtime
  for both export and import, and validating equality on import.
- Large datasets: current data is small (hundreds of rows); ExcelJS in-memory is
  fine. No streaming needed (YAGNI).
- `app_settings` is a single fixed row; restore replaces it rather than relying
  on reset defaults.
