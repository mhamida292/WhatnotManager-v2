# Unified Item Identifiers — design spec

**Date:** 2026-07-23
**Branch:** `feat/unified-item-identifiers`
**Status:** Draft (brainstorming), pending user review → implementation plan

## Problem

Referring to an inventory item is fragmented and fragile:

- An item's identity **is its `name`** (`inventory_items.name` is `UNIQUE`). There
  is no stable code you can rename around, so renaming an item is risky.
- Whatnot listing names map to items through `product_aliases`
  (`product_name UNIQUE → item_id`) — a mapping table used **only** by the ledger
  import. Many names → one item already works here.
- Supplier codes/SKUs have **no representation at all**. Invoice posting matches
  an unlinked purchase line by **exact item name**, else silently creates a new
  item (`postInvoice`, `src/lib/db/invoices.ts:126–133`) — a common source of
  accidental duplicate items.

The user buys the same product from multiple suppliers (each with its own SKU)
and sells it under multiple Whatnot names, and wants all of them to roll up into
one item — with an identity that survives renaming.

## Goal

One item identity (an internal **SKU**) plus **one list of alternate
identifiers** per item, covering every way the item is referred to — the user's
own SKU, each supplier's SKU, and each Whatnot listing name. All three surfaces
(Whatnot import, invoices, manual inventory) resolve names/codes through that one
list. Renaming an item's display name never affects matching, because nothing
keys off the name.

**In scope:** the identifier data model + migration; a shared resolver; a
suggest-and-confirm "unmapped" flow for both Whatnot import and invoice posting;
a SKU-manager UI (per-item identifier editing + item merge).

**Out of scope (future to-dos, hang off this backbone):** photo system, notes
system, label/barcode printing. The existing one-time `automap` CLI
(`docs/.../2026-07-07-automap-aliases-design.md`) is **superseded** by the live
suggest-and-confirm flow described here.

## Data model

Add a `sku` column to `inventory_items`:

- `sku TEXT UNIQUE` — the item's identity. Auto-generated on create (sequential,
  e.g. a zero-padded counter or `ITEM-000123`), **editable** by the user.

**Drop the `UNIQUE` constraint on `inventory_items.name`.** With the SKU as
identity, the display name is a mutable label; two items may legally share a name
(the SKU keeps them distinct). SQLite can't drop a column constraint in place, so
this is done via the standard table-rebuild migration (create new table, copy,
swap) — see Migration.

New table, replacing the role of `product_aliases`:

```
CREATE TABLE item_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('mine','supplier','whatnot')),
  code TEXT NOT NULL,             -- the SKU or product name, normalized
  supplier_label TEXT,            -- optional, e.g. "Supplier A" (source='supplier')
  UNIQUE(code)
);
```

- `UNIQUE(code)` preserves today's `product_aliases.product_name UNIQUE`
  guarantee: any given code/name resolves to exactly one item.
- Whatnot names are stored `baseProductName`-normalized (strip trailing ` #N`),
  exactly as `setAlias` does today.
- `product_aliases` is **removed** after migration.

## Migration (automatic, on first load)

Runs in the app's existing auto-migration path (schema is created/migrated on
first access). Idempotent.

1. Rebuild `inventory_items` with `sku TEXT UNIQUE` added and the `name` `UNIQUE`
   constraint removed; copy all existing rows.
2. Back-fill a generated unique `sku` for every existing item.
3. Create `item_identifiers`. For each item, insert a `source='mine'` row with
   `code = sku`.
4. Copy every `product_aliases` row into `item_identifiers` as
   `source='whatnot'` (`code = product_name`, same normalization). Assert count
   matches (lossless).
5. Drop `product_aliases`.

**Existing sales, invoice lines, and purchase batches are untouched** — they
already carry a concrete `item_id`, so nothing recomputes and no stock number
changes.

## Resolution flow (shared)

Replace `resolveItemId(db, code)` to look up `item_identifiers.code` instead of
`product_aliases.product_name` (same normalization). Every surface calls it:
Whatnot ledger import, invoice posting, and manual inventory entry. `setAlias`
becomes `setIdentifier(db, { code, itemId, source, supplierLabel? })` writing an
`item_identifiers` row (upsert on `code`).

## Suggest-and-confirm (unmapped tray)

Any imported name/code that `resolveItemId` can't match is **unmapped** and
surfaced in a tray, unified across Whatnot import **and** invoice posting.

- A reusable **fuzzy scorer** (`score(name, itemName) → 0..1`) proposes the
  single best-match item per unknown. This is the scoring logic the `automap`
  spec described, extracted into a shared lib usable by the UI.
- **High confidence (≥ threshold):** the suggested item is pre-selected;
  **Confirm** is a one-click primary action.
- **Low confidence (< threshold):** the app flags it and defaults the user toward
  **Change/review** rather than one-click confirm.
- Always an option to **create a new item** from the unknown.
- Confirming writes one `item_identifiers` row (`source='whatnot'` for import,
  `source='supplier'` for invoices) → resolved permanently; never asked again.

**Invoice posting behavior change (deliberate):** an unlinked purchase line no
longer silently exact-name-matches-or-creates. Posting routes unlinked lines
through this same suggest-and-confirm flow. This replaces
`invoices.ts:126–133`'s auto-create path and prevents accidental duplicates.

## SKU-manager UI

Per-item view listing all identifiers grouped by source (`mine` / `supplier` /
`whatnot`):

- Add / remove / re-point an identifier; edit the item's own SKU and display name.
- **Merge two items** (fix accidental duplicates): move the merged item's
  identifiers **and** stock history (`item_purchases`, `invoice_lines`,
  `show_line_items`, `ledger_transactions`, `inventory_adjustments`,
  `inventory_moves`, `bundle_components`) onto the survivor by re-pointing
  `item_id`, then delete the emptied item. This is the **only** operation that
  rewrites `item_id` on existing posted rows, and only on explicit user action.
  Guard against the `UNIQUE(code)` collision if both items share a code.

## Effect on existing invoiced / posted-to-inventory data

- Posted invoice lines keep their stored `item_id` — no re-derivation from name.
- Inventory stock = `item_purchases` batches (fixed `item_id`/qty/cost) — unchanged.
- Reversing a posted invoice is unchanged (driven by `item_id` via `item_purchases`).
- Renaming an item's display name afterward affects none of the above.

## Testing

- **Fuzzy scorer:** unit tests over representative Whatnot-name↔item pairs
  (incl. the known `"Highland Cow Squishy (Assorted Colors)"` → `"Highland Cow"`).
- **Resolver:** resolves across all three sources; normalization parity with the
  old `product_aliases` behavior.
- **Migration:** on a DB seeded with `product_aliases`, assert every alias becomes
  a `source='whatnot'` identifier (lossless count + spot checks), every item gets
  a unique `sku` and a `source='mine'` identifier, and no `item_id` on existing
  sales/invoice/purchase rows changes.
- **Merge:** all listed history tables re-point to the survivor; emptied item
  deleted; `UNIQUE(code)` collisions handled.
- **Invoice posting:** unlinked line routes through suggest-and-confirm; confirmed
  match writes a `source='supplier'` identifier and creates the purchase batch;
  posted totals match pre-change behavior for already-linked lines.

## Open questions / risks

- **`UNIQUE(code)` collision on supplier/whatnot writes (carried from Plan 1 review).**
  `item_identifiers` uses a **global** `UNIQUE(code)`, so a `whatnot` or `supplier`
  code equal to an existing item's `mine` sku (`ITEM-#####`) or another item's code
  collides. Plan 1's migration now **aborts loudly** on such a collision (no silent
  data loss), and `resolveItemId` matching any source is intentional. **Plan 2 must
  harden the runtime write paths before introducing `supplier` codes:** `setAlias`'s
  `ON CONFLICT(code) DO UPDATE ... source='whatnot'` currently would silently re-point
  a non-whatnot row (stealing a `mine`/`supplier` identifier). Before Plan 2 writes
  supplier codes, `setIdentifier`/`setAlias` must reject (or explicitly handle) a
  collision with a different-source identifier rather than converting it. Plan 3's
  merge already flags `UNIQUE(code)` handling.
- **SKU format** for auto-generation (plain sequential vs. prefixed). Default:
  simple zero-padded sequential; user-editable. Low risk; decide at implementation.
- **Fuzzy threshold** value — tune against real data during testing on this branch.
- Table-rebuild migration must register `item_identifiers` (and the rebuilt
  `inventory_items`) in the Excel backup `TABLES` list to avoid schema-drift
  (cf. commit `7f1cacb` — a prior missed-table-in-backup bug).
