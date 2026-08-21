# Remove the Brother Concept — Design

**Date:** 2026-07-27
**Status:** Approved (pending spec review)

## Context

`brother_transactions` is a vestige of an early cost-sharing model. Its UI was
removed on 2026-06-22 (`2026-06-22-remove-brother-ui-and-owner-share-card-design.md`),
but the plumbing underneath stayed.

The concept is now **unreachable**: `insertBrotherTxn` has no non-test caller. No
API route, UI control, or script writes to the table, so the running app cannot
create a brother row. Only `tests/lib/db/inventory.test.ts` calls it, which is
what has kept it compiling and made it look alive.

Live data across all four workspaces is a single inert row:
`kind: 'bought_from_brother'`, `qty: 0`, `amount_cents: 0`, all cost columns NULL.
It contributes 0 to every calculation.

The owner's framing: the concept is outdated — the business is now sales invoices
and purchase invoices.

## Goals

1. Delete the concept end to end — table, DB functions, calc inputs, UI strings.
2. **Change no number anywhere.** Every current contribution is already 0.
3. Keep Excel backup/restore working, including restoring **older** backups that
   still contain a `brother_transactions` sheet.

## Out of Scope

- The Whatnot-only inventory toggle (separate spec, implemented after this).
- Any other change to inventory, spend, or COGS math.

## Changes

### Schema and migration

- Drop `CREATE TABLE brother_transactions` from the `SCHEMA` string.
- `migrate(db)`: add an idempotent `DROP TABLE IF EXISTS brother_transactions`.
- Remove the table from the delete-order list at `inventory.ts:309`.

### DB layer — `src/lib/db/inventory.ts`

- Delete `insertBrotherTxn` and `qtyGivenToBrother`.
- `qtySold` (line 130): drop the `qtyGivenToBrother` term.
- `warehouseQty` needs **no edit**: it is derived as `qtyRemaining − whatnotQty`
  (`inventory.ts:178`) and never references brother directly. Brother reached it
  only through `qtySold → qtyRemaining`, so removing the term above is sufficient
  and the bucket partition still holds.
- `deleteItem` (line 53): remove the `UPDATE brother_transactions SET item_id = NULL` detach.
- `DeleteImpact`: remove the `brotherTxns` field and its count query (line 74).
- Remove the now-unused `brotherShipmentOwnerCost` import.

### Calc layer

- `src/lib/calc/inventory-spend.ts`: delete `brotherShipmentOwnerCost`,
  `BrotherTxnKind`, and `BrotherTxnForSpend`. `netInventorySpend` narrows to
  `{ itemCostsCents }`.
- `src/lib/calc/dashboard.ts:24` and `src/app/inventory/page.tsx:36`: drop the
  `brother_transactions` query and the `brotherTxns` argument.

### UI

- `src/app/inventory/[id]/page.tsx`: remove the `qtyGivenToBrother` import and
  call, drop the `"Sold — gave to brother"` breakdown row, and remove the term
  from `totalSold`.
- `src/components/DeleteItemButton.tsx:21` and `src/lib/ui/bulk-delete-message.ts:12`:
  remove the `brotherTxns` message branches.

### Admin

- `src/lib/db/admin.ts:15`: remove `DELETE FROM brother_transactions` from reset.

### Excel backup

- `src/lib/backup/workbook.ts:12`: remove `"brother_transactions"` from `TABLES`.
- **No import change needed.** `importWorkbook` iterates `TABLES` and fetches each
  sheet by name, so a sheet absent from that list is simply never read. Older
  backups containing a brother sheet therefore restore cleanly, ignoring it. This
  is covered by a test rather than by new code.

## Testing

**Preserve coverage, don't delete it.** `tests/lib/db/inventory.test.ts` uses
`insertBrotherTxn` at five sites as a convenient source of "sold" units to assert
`qtySold` and `qtyRemaining`. Naively deleting those cases would silently drop
genuine coverage of core stock math. Each must be **ported** to another sale path
(wholesale invoice line or ledger sale) so the same assertions still run.

Other test updates:

- `admin.test.ts`, `connection.test.ts`, `merge-items.test.ts`,
  `inventory-spend.test.ts`, `bulk-delete-message.test.ts`: drop brother
  assertions and arguments.
- **New:** restoring a workbook that contains a `brother_transactions` sheet
  succeeds and ignores it (proves old backups still work).
- **New:** `migrate(db)` on a DB that has the table drops it, and is safe to run
  twice.

Verify with `npm test` and `npm run build`.

## Risks

- **Lost coverage** via careless test deletion — mitigated by the porting rule above.
- **A stale `data/whatnot.db`** or an old workspace DB may still hold the table;
  the migration's `DROP TABLE IF EXISTS` handles both present and absent cases.
