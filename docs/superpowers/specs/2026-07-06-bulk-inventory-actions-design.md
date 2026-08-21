# Bulk Inventory Actions — Design

**Date:** 2026-07-06
**Status:** Approved design, pending spec review
**Area:** `/inventory` list (active table + archived section), `src/lib/db/inventory.ts`, new bulk API routes.

## Motivation

With archiving in place, acting on inventory one row at a time is tedious — the
user wants to select several items and apply one action. Scope is deliberately
narrow: **bulk Archive/Unarchive and bulk Delete** only (not bulk edit or bulk
count — the `/inventory/count` page already covers batch counting).

## Decisions

### Selection model (approved via mockup)
- A **checkbox on each row** plus a header **"select all"** that selects only the
  **currently filtered/searched** rows (not hidden ones).
- Selected rows are highlighted. A **bulk action bar** appears once ≥1 row is
  selected, showing the count, the action buttons, and **Clear**.
- Selection is **per table** (it does not span the active table and the archived
  section):
  - **Active table** → **Archive** + **Delete**
  - **Archived section** → **Unarchive** + **Delete**

### Delete safety (option A)
- **Bulk delete** shows an **aggregate impact confirmation** before running —
  mirroring the existing single-item delete warning, scaled up:
  *"Delete 3 items? This unmaps 5 Whatnot names and detaches 40 sales rows.
  Cannot be undone."* — with a single confirm (no type-to-confirm).
- **Bulk archive/unarchive need no confirmation** (reversible).

### Core invariant (unchanged)
Archiving/unarchiving is organizational only — no money/stock math changes.
Delete keeps its existing cascade semantics (unmap aliases; NULL the cached
`item_id` on ledger/show/brother rows; sales history rows are kept, just
detached). No calc/report code changes.

## Data model
No schema changes. Built entirely on existing columns and single-item functions.

## DB layer (`src/lib/db/inventory.ts`)
All batch helpers wrap the existing single-item functions in ONE transaction:
- `archiveItems(db: DB, ids: number[]): void` — loops `archiveItem`.
- `unarchiveItems(db: DB, ids: number[]): void` — loops `unarchiveItem`.
- `deleteItems(db: DB, ids: number[]): void` — loops `deleteItem` (each already a
  transaction; wrapping in an outer transaction is safe and makes the batch
  atomic).
- `bulkDeleteImpact(db: DB, ids: number[]): { items: number; mappings: number; ledgerSales: number; showLineSales: number; brotherTxns: number }` —
  sums the existing `deleteImpact(db, id)` across `ids` (plus `items = ids.length`).

## API
- `POST /api/inventory/bulk` — body `{ action: "archive" | "unarchive" | "delete", ids: number[] }`.
  Validates `action` is one of the three and `ids` is a non-empty array of
  integers (400 otherwise). Dispatches to the matching batch helper via
  `await dbForRequest()`. Returns `{ ok: true }`.
- `POST /api/inventory/bulk-delete-impact` — body `{ ids: number[] }` → returns the
  aggregate impact object (from `bulkDeleteImpact`) to populate the confirm dialog.

## Components / files
- `src/components/inventory/BulkActionBar.tsx` — NEW; props `{ count, actions: { label, variant, onClick }[], onClear }`. Shared by both tables.
- `src/components/inventory/BulkDeleteConfirm.tsx` — NEW; modal showing the
  aggregate impact + Cancel / Delete; calls the delete on confirm.
- `src/components/InventoryTable.tsx` — add a checkbox column, `Set<number>`
  selection state, header select-all over the currently filtered/sorted rows, and
  the `BulkActionBar` (Archive + Delete). Delete opens `BulkDeleteConfirm`.
- `src/components/inventory/ArchivedTable.tsx` — NEW client component replacing the
  inline server-rendered `<details>` markup in `page.tsx`; same selection + bar
  (Unarchive + Delete). Keeps the collapsible "Archived (N)" wrapper.
- `src/app/inventory/page.tsx` — render `ArchivedTable` (passing the archived rows)
  in place of the inline archived markup. No change to the stat cards (they already
  correctly cover all items).
- `src/app/api/inventory/bulk/route.ts` and `src/app/api/inventory/bulk-delete-impact/route.ts` — NEW.

## Error handling
- Bulk API: 400 on bad `action` or empty/invalid `ids`. Unknown ids are harmless
  no-ops (single-item functions already no-op on missing rows).
- Each batch is a single transaction — a mid-batch failure rolls back (no
  half-applied state).
- Delete confirm dialog is populated from the impact endpoint; if that fetch
  fails, it surfaces an error and does not proceed to delete.
- After any bulk op: client clears selection + `router.refresh()`.
- Empty selection: the action bar isn't rendered, so actions can't fire on nothing.

## Testing (Vitest, db layer)
- `archiveItems` / `unarchiveItems` set/clear `archived_at` on all given ids and
  leave non-selected items untouched.
- `deleteItems` removes all given ids and cascades (aliases unmapped; ledger/show/
  brother `item_id` nulled), atomically.
- `bulkDeleteImpact` equals the sum of per-item `deleteImpact` across the ids.
- **Invariant guard:** archiving a batch leaves `buildLedgerReport` byte-identical.
- UI (checkboxes, bar, dialog) follows the project's no-React-unit-test convention
  — covered by type-check, build, and the final manual smoke.

## Out of scope / deferred
- Bulk edit (unit cost) and bulk map — not requested.
- Selection spanning both tables at once.
- Undo for bulk delete (delete stays irreversible, guarded by the impact dialog).
