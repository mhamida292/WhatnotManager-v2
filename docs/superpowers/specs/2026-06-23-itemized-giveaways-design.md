# Itemized Giveaways — Design

**Date:** 2026-06-23
**Status:** Approved (brainstorm), pending implementation plan

## Problem

Today every giveaway is costed at a single flat rate (`app_settings.giveaway_unit_cents`,
also mirrored per-show as `shows.giveaway_unit_cents`). The cost of a show's giveaways is
computed in `src/lib/calc/ledger-report.ts` as:

```ts
const giveawayCostCents = giveawayCount * settings.giveawayUnitCents;
```

The user now gives away a **mix** of different items in a single show, each with its own
cost — e.g. a 19-giveaway show: 15 stickers, 2 × $5 Amazon gift cards, 1 × $0.50 squishy.
A flat per-unit cost can no longer represent reality. We need real, per-item giveaway costing.

## Decisions (made with user)

- **Separate giveaway catalog, not inventory-linked.** Giveaway items (including squishies)
  are their own catalog and do **not** draw down inventory stock or read inventory unit costs.
  Stickers and gift cards aren't in inventory anyway; squishy giveaways are rare 1-offs.
- **Bulk-pack costing.** A giveaway item stores the pack cost and pack quantity (e.g.
  `$9.99 / 600`). The per-unit cost is derived as a float at compute time, never stored as
  rounded cents — so 15 stickers cost `$0.25`, not `2¢ × 15 = $0.30`.
- **Per-show allocation lives on the show detail page.** The ledger detects the giveaway
  *count*; the user assigns *what* those giveaways were.
- **Unallocated shows cost $0 and are flagged.** Until the user fills in a show's giveaway
  split, its giveaway cost is $0 and the show carries a "giveaways not entered" flag. Profit
  is slightly overstated until allocated (consistent with how unmapped products already work).

## Components

### 1. Giveaway Items catalog (new)

New table `giveaway_items`:

| column            | type    | notes                                   |
|-------------------|---------|-----------------------------------------|
| `id`              | INTEGER | PK AUTOINCREMENT                        |
| `name`            | TEXT    | NOT NULL (e.g. "Stickers")              |
| `pack_cost_cents` | INTEGER | NOT NULL — cost of one pack             |
| `pack_qty`        | INTEGER | NOT NULL, default 1 — units per pack    |
| `active`          | INTEGER | NOT NULL default 1 (boolean 0/1)        |

Derived unit cost = `pack_cost_cents / pack_qty` (float; used only in computation).
For single items (gift card, squishy) `pack_qty = 1`, so unit cost = `pack_cost_cents`.

`active = 0` retires an item from the picker without breaking historical allocations that
still reference it.

CRUD lives in **Settings** (`/settings`): list, add, edit, deactivate giveaway items.
DB access in a new `src/lib/db/giveaway-items.ts`.

### 2. Per-show allocation (new)

New table `show_giveaway_allocations`:

| column              | type    | notes                                          |
|---------------------|---------|------------------------------------------------|
| `id`                | INTEGER | PK AUTOINCREMENT                               |
| `show_id`           | INTEGER | NOT NULL REFERENCES shows(id) ON DELETE CASCADE|
| `giveaway_item_id`  | INTEGER | NOT NULL REFERENCES giveaway_items(id)         |
| `count`             | INTEGER | NOT NULL — units of this item given this show  |

On the show detail page (`src/app/shows/[id]/page.tsx`) a Giveaways section:
- Displays the ledger-detected giveaway count for the show.
- Lets the user add/edit/remove rows: pick a catalog item + enter a count.
- Shows a live tally of allocated count and total allocated cost.
- Flags a mismatch when `Σ count ≠ detected giveaway count`.

DB access in `src/lib/db/giveaway-items.ts` (or a sibling module).

### 3. Costing change

In `src/lib/calc/ledger-report.ts`, replace the flat computation with allocation-based cost:

```ts
// allocations for this show, joined to giveaway_items
const giveawayCostCents = Math.round(
  allocations.reduce((sum, a) => sum + a.count * (a.packCostCents / a.packQty), 0)
);
```

- Rounding happens **once at the end**, after summing float per-unit costs.
- If a show has **no allocations**, `giveawayCostCents = 0` and the show is marked
  `giveawayUnallocated: true` (a new flag on the report's `ReportShow`).
- `giveawayCount` (detected) is still reported for display + mismatch checks.

Because the dashboard (`dashboardSummary`) and `/report` both read `buildLedgerReport`, the
new costs flow through net profit and the owner/partner split with no further changes.

### 4. Settings cleanup

`app_settings.giveaway_unit_cents` and `shows.giveaway_unit_cents` are no longer used for
costing. Leave the columns in place (harmless, avoids a destructive migration) but remove the
"giveaway unit cost" input from the Settings form, replaced by the Giveaway Items list UI.

### 5. Migration / data safety

Both new tables are additive via `CREATE TABLE IF NOT EXISTS` in `src/lib/db/schema.ts`
(the SCHEMA string runs on every connection in `connection.ts`). No existing data is touched.
Existing shows start unallocated → $0 + flag until the user enters their splits.

## Data flow

```
Whatnot ledger CSV ──import──> ledger_transactions (kind='giveaway' → giveawayCount per show)
                                          │
user (Settings) ──> giveaway_items        │
user (Show page) ──> show_giveaway_allocations (show_id, item_id, count)
                                          │
                          buildLedgerReport() joins allocations × giveaway_items
                                          │  cost = round(Σ count × pack_cost/pack_qty)
                                          ▼
                       ReportShow.giveawayCostCents (or 0 + giveawayUnallocated flag)
                                          ▼
                       net profit → owner/partner split → dashboard + /report
```

## Error handling / edge cases

- **Unallocated show:** cost $0, `giveawayUnallocated` flag shown on show page, dashboard,
  and report.
- **Allocated ≠ detected:** non-blocking warning on the show page; cost still computed from
  what's entered (user may legitimately know better than the ledger).
- **Deactivated item still referenced by old allocation:** costing still works (we read the
  item row regardless of `active`); the picker just won't offer it for new rows.
- **pack_qty must be ≥ 1:** validated on save to avoid divide-by-zero.

## Testing (Vitest units)

- Unit-cost derivation: `$9.99 / 600` → correct float; `$5.00 / 1` → 500.
- Per-show cost summation + single end rounding: 15 stickers + 2 cards + 1 squishy → `$10.75`;
  15 stickers alone → `$0.25` (not `$0.30`).
- Unallocated show → cost 0 + `giveawayUnallocated` true.
- Mismatch flag: allocated 18 vs detected 19 → mismatch true, cost still from allocations.

## Out of scope

- Inventory draw-down for giveaways (rejected: separate catalog chosen).
- Changing how the ledger **detects** giveaways (`/giveaway/i` classification unchanged).
- Historical bulk back-fill tooling — user fills shows in as needed.
