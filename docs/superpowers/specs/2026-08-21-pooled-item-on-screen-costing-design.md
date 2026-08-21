# Pooled ("Item On Screen") Costing — Design

**Status:** Approved by user, ready for implementation planning.
**Date:** 2026-08-21

## Context

The user is running a second Whatnot stream under a new account, using
Whatnot's "Item On Screen" mystery-pull format: every sale is a random,
unidentified pull from a large mixed pool of SKUs. Each physical pull is
numbered for packing/shipping only — the number does not map back to a
product identity, so there is no way to know which SKU a given sale line
corresponds to. This breaks the app's existing costing model, which requires
resolving every Whatnot product name to a specific inventory item (via the
alias/`item_identifiers` map) to price COGS.

Purchasing is unaffected: the user still buys distinct SKUs at known, itemized
costs (invoices/purchase batches), they just can no longer attribute a *sale*
to one of those SKUs.

Goal: know whether the new stream is profitable on average, without per-SKU
sale attribution. Per-SKU stock tracking may return as an option later but is
explicitly out of scope for v1 ("as of now I don't think it's necessary").

## Non-goals

- Per-SKU inventory tracking/reporting for the pooled stream (v1).
- Any change to the existing per-SKU stream's behavior or data.
- Bundles in pooled mode (bundles require known components; not used on the
  new stream today — if it comes up later, bundle sale lines can keep using
  per-item costing even inside an otherwise-pooled workspace, as a follow-up).
- Giveaways: confirmed to be a separate listing/stock, unrelated to the
  on-screen pool. No changes to giveaway cost/allocation logic.

## Approach: workspace-level costing mode, not a fork

The app already isolates data per user account (`data/ws/<userId>.db`,
`getDb(userId)` in `src/lib/db/connection.ts`). The vast majority of the
ledger/report pipeline — CSV import, tips/bonus/giveaway-fee/payout parsing,
shipping supplies, owner/partner split, dashboard, Excel backup — has nothing
to do with SKU costing. Forking to a separate repo/app would duplicate all of
that and double the maintenance cost of every future bug fix or CSV-format
change.

Instead: add a **costing mode** setting per workspace. Create a second user
account for the new stream (Settings → Users, existing feature); set that
workspace's costing mode to `pooled`. The original account/workspace stays on
`per_sku` (today's behavior, unchanged) by default.

## Data model changes

`app_settings` (one row per workspace, `id = 1`) gets two new columns, added
via the existing idempotent `migrate()` pattern in
`src/lib/db/connection.ts`:

```sql
ALTER TABLE app_settings ADD COLUMN costing_mode TEXT NOT NULL DEFAULT 'per_sku'
  CHECK (costing_mode IN ('per_sku','pooled'));
ALTER TABLE app_settings ADD COLUMN avg_method TEXT NOT NULL DEFAULT 'moving'
  CHECK (avg_method IN ('moving','live'));
```

Follow the existing precedent for enum-ish columns added via migration (e.g.
`invoices.direction`, added as `ALTER TABLE invoices ADD COLUMN direction
TEXT NOT NULL DEFAULT 'purchase'` with no inline `CHECK`): the `ALTER TABLE`
migration statements above add the columns without a `CHECK`; the value set
is enforced in `updateSettings` (application-level validation), matching how
`direction` is handled today. The fresh-schema `CREATE TABLE app_settings` in
`schema.ts` (for brand-new databases) does include the `CHECK`, same as any
other constrained column defined there from the start.

`avg_method` only has an effect when `costing_mode = 'pooled'`.

`Settings` interface/`getSettings`/`updateSettings` in `src/lib/db/settings.ts`
gain `costingMode: 'per_sku' | 'pooled'` and `avgMethod: 'moving' | 'live'`.
Settings UI gets a "Costing mode" control (with the avg-method sub-choice
shown only when pooled is selected).

No changes to `inventory_items`, `item_purchases`, invoices, or the
purchase/invoice entry UI — buying inventory stays exactly as it is today,
per SKU, at real cost. That data is what feeds the pool.

## Pool cost calculation

New module, e.g. `src/lib/calc/pool-cost.ts`. Both methods are pure,
recomputed live at report time — consistent with the rest of the app
(`buildLedgerReport` already resolves item costs live; nothing here
introduces stored derived state).

**Inputs**, both scoped to the whole workspace (all items, no per-SKU
grouping):

- All `item_purchases` rows (id, `purchased_on`, quantity, unit_cost_cents).
- All `ledger_transactions` rows where `kind = 'sale'` (id, `created_at`,
  amount_cents) — cost only depends on the *count* of sales at a point in
  time, not `product_name` or `amount_cents`.

### Live method (`avg_method = 'live'`)

```
totalUnitsPurchased = Σ quantity over all item_purchases
totalSpendCents      = Σ (quantity × unit_cost_cents) over all item_purchases
poolAvgUnitCostCents  = totalUnitsPurchased > 0
                          ? round(totalSpendCents / totalUnitsPurchased)
                          : 0
```

Applied uniformly to every sale in every report: `cogsCents(show) =
saleCount(show) × poolAvgUnitCostCents`. Recomputing after a new purchase
changes the average applied to *all* historical shows the next time a report
is built — this is a known, accepted trade-off (mirrors how per-item costing
already behaves today), which is why it's the non-default option.

### Moving average / AVCO (`avg_method = 'moving'`, default)

Chronological walk over purchases and sales merged into one timeline, ordered
by date (purchases by `purchased_on`, sales by `created_at`; ties broken
purchases-before-sales same day, then by row id):

```
runningUnits = 0
runningValueCents = 0
avgAtSaleId = {}   // sale ledger_transactions.id -> unit cost cents locked at that sale

for event in timeline (chronological):
  if event is a purchase (qty, unitCostCents):
    runningUnits += qty
    runningValueCents += qty * unitCostCents
  if event is a sale (id):
    avg = runningUnits > 0 ? round(runningValueCents / runningUnits) : 0
    avgAtSaleId[id] = avg
    runningValueCents -= avg   // one unit consumed per sale row
    runningUnits -= 1

currentPoolAvgUnitCostCents = runningUnits > 0 ? round(runningValueCents / runningUnits) : 0
```

`cogsCents(show) = Σ avgAtSaleId[saleTxnId] for that show's sale transactions`.
A sale's locked cost never changes on recompute; only the *current* average
(shown on the pool summary card) moves as new purchases/sales occur.

**Data requirement:** the moving-average walk needs a real date for every
purchase. `item_purchases.purchased_on` is nullable today (some purchase
batches, especially legacy backfilled ones, have `NULL`). For pooled-mode
workspaces, the purchase-entry UI should require a date. A `NULL`
`purchased_on` in a moving-average walk is treated as earliest-possible
(sorted first) — acceptable as a fallback, but the implementation plan should
flag this so entry forms nudge the user to always set a date in pooled mode.

## `buildLedgerReport` changes

In `src/lib/calc/ledger-report.ts`, branch near the top on
`settings.costingMode`:

- **`per_sku`** (default): entirely unchanged — same alias resolution,
  per-product-line breakdown, per-item cost.
- **`pooled`**: skip `resolveItemId`/alias resolution and per-product-name
  grouping entirely (there is nothing meaningful to group by — every sale is
  the same generic listing name). For each show: `unitsSold = saleCount`,
  `cogsCents = poolCost(show's sale txn ids)` per the chosen `avg_method`.
  `products: []` (or omit) on `ReportShow` for pooled workspaces — no
  per-product-line UI to render.

Tips, bonus, payout, giveaway fee/cost, shipping supplies, withdrawals,
owner/partner split, wholesale rollup: **all unchanged** — none of that logic
depends on SKU resolution today.

## Units on hand

```
unitsOnHand = totalUnitsPurchased − totalSaleCount   (all-time, this workspace)
poolValueCents = unitsOnHand × currentPoolAvgUnitCostCents
```

Giveaways don't subtract here (confirmed separate stock/listing).

## Dashboard / UI changes (pooled workspaces only)

1. **Pool summary card**: units purchased, units sold, units on hand, current
   avg cost/unit, value on hand. Replaces the per-SKU in-stock table for
   these workspaces.
2. **Show list**: per-show line shows units sold, revenue, pool COGS, net
   profit — no per-product rows.
3. **Per-show detail**: a collapsible raw list of each individual sale amount
   for that show (no SKU attached), so the user can eyeball unusually high or
   low sale prices. (User-selected option during design review.)
4. Settings page: costing-mode selector (`per_sku` / `pooled`), with an
   avg-method sub-selector (`moving` default / `live`) shown when `pooled` is
   selected.

## Decisions made during design review

- Fork vs. extend: **extend** — new workspace (existing multi-user feature)
  + a costing-mode setting, not a separate repo.
- Averaging method: **moving average (AVCO)** by default — historical
  per-show profit stays fixed once booked, matching the user's actual goal
  (trustworthy profit trend over time). A **live all-time average** toggle is
  also implemented (cheap, since both are pure recomputations with no stored
  state) for a quick "what's my blended cost right now" gut check — not
  intended for trend tracking, since it re-prices past shows on every
  purchase.
- Per-show sale detail: include a **collapsible raw sale-amount list**
  alongside the minimal summary line (not summary-only).
- Giveaways: unchanged, confirmed unrelated to the on-screen pool.

## Open follow-ups (explicitly deferred, not part of this spec)

- Optional per-SKU tracking layer on top of the pool, if the user later wants
  reorder visibility for individual products within the mixed pool.
- Bundles inside a pooled workspace (not currently used there).
- Adjustments (samples/damage/recount) against the pool total — not raised by
  the user; today's adjustment log is per-item and doesn't apply to a pool.
