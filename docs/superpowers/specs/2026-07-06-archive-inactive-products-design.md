# Archive / Inactive Products — Design

**Date:** 2026-07-06
**Status:** Approved design, pending spec review
**Area:** `/inventory` list, `/inventory/[id]`, `/inventory/count`, alias mapping picker, `src/lib/db/inventory.ts`, schema.

## Motivation

The user carries products that they eventually stop selling (discontinued, won't
restock). Today the only way to get such an item out of the way is Delete, which
unmaps its Whatnot names and detaches its sales/ledger rows — destructive and
recoverable only by re-adding + re-mapping. They want a **soft** alternative:
mark an item **archived** so it drops out of the day-to-day views while keeping
all of its data and history intact.

## Core invariant

**Archiving is purely organizational.** It changes only where an item *appears*,
never any money or stock math. An archived item's historical sales still count in
`/report` and profit exactly as before. This is a hard requirement and gets a
dedicated guard test. It holds naturally because COGS/`qtyRemaining`/the ledger
report resolve through the alias + ledger joins, not through the archived flag.

## Decisions

### Trigger (manual + suggested)
- **Manual:** any item can be archived (and unarchived) at any time via a row
  action and a button on the item detail page.
- **Suggested (inline nudge):** an active item at **0 remaining** renders its
  Archive action as a highlighted **"Archive?"** prompt, drawing attention where
  it's relevant. No banner, no separate list, no auto-hiding — the user always
  confirms by clicking.

### Where an archived item shows vs hides (approved)
| Surface | Archived item |
|---|---|
| Inventory list (`/inventory`) | Hidden from the main table; listed under a collapsible **"Archived (N)"** section |
| Count page (`/inventory/count`) | Hidden (you don't count what you don't carry) |
| Item detail page (`/inventory/[id]`) | Still reachable; has an Unarchive control |
| `/report` & profit math | Unchanged — historical sales still count fully |
| Alias mapping (Whatnot name → item) | Stays mapped; not offered as a target for *new* mappings |

## Data model

Add a nullable column to `inventory_items`:

```
archived_at TEXT   -- NULL = active; ISO date string = archived (records when)
```

- Migration: guarded `ALTER TABLE inventory_items ADD COLUMN archived_at TEXT` in
  `migrate()` (idempotent, PRAGMA-gated), and `archived_at TEXT` added to `SCHEMA`
  for fresh DBs.
- `archived_at` lives inside `inventory_items`, which the backup workbook captures
  column-by-column via PRAGMA — it round-trips automatically and the drift-guard
  stays green. No `TABLES` change.

## DB layer (`src/lib/db/inventory.ts`)

- `ItemRow` gains `archivedAt: string | null`.
- `listItems(db)` selects `archived_at AS archivedAt` and returns it (still returns
  ALL items; consumers split active vs archived by the flag).
- `archiveItem(db, id): void` — `UPDATE inventory_items SET archived_at = <today> WHERE id = ?`.
- `unarchiveItem(db, id): void` — `UPDATE inventory_items SET archived_at = NULL WHERE id = ?`.
- No change to `qtyRemaining`, `qtySold*`, alias/earnings/report functions.

## Components / files

- `src/lib/db/inventory.ts` — column in `listItems`, `ItemRow`, + archive/unarchive.
- `src/app/inventory/page.tsx` — split items into active (main table) and archived
  (collapsible section); pass an `archived` flag / render the Unarchive action.
- `src/components/InventoryTable.tsx` — render an Archive/"Archive?" action per row
  (nudge when `remaining === 0`); render Unarchive for archived rows. (If the table
  is shared, parameterize the action by archived state.)
- `src/components/inventory/ArchiveButton.tsx` — NEW client control; `POST`s
  `{ archived }` then `router.refresh()`. Reused on the list rows and the detail page.
- `src/app/inventory/[id]/page.tsx` — Archive/Unarchive control (separate from the
  Danger zone).
- `src/app/inventory/count/page.tsx` — filter `listItems` to `archivedAt == null`.
- Alias mapping target picker (the "Map Whatnot name → item" combobox source) —
  exclude archived items from the offered options; existing mappings are untouched.
- `src/app/api/inventory/[id]/archive/route.ts` — NEW `POST` `{ archived: boolean }`
  → `archiveItem` / `unarchiveItem` via `await dbForRequest()`.

## Error handling
- Archive/unarchive of a non-existent id is a harmless no-op (UPDATE affects 0 rows).
- The API validates `archived` is a boolean; anything else → 400.
- Archiving never blocks on stock or sales state — it's always allowed.

## Testing
- Unit (Vitest): `archiveItem` sets `archived_at`; `unarchiveItem` clears it;
  `listItems` surfaces `archivedAt`.
- **Invariant guard:** build an item with ledger sales, snapshot `qtyRemaining` and
  the ledger report totals, archive it, and assert both are byte-identical after.
- Count-page source excludes archived; alias target list excludes archived.

## Out of scope / deferred
- Bulk archive / multi-select.
- Auto-archiving without confirmation (explicitly rejected — nothing hides itself).
- A separate `/inventory/archived` page (a collapsible section on `/inventory` suffices).
