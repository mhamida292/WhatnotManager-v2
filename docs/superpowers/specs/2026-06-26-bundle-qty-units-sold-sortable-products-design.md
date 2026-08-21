# Bundle quantity, order numbers, units-sold, and sortable Products tables

**Date:** 2026-06-26
**Status:** Approved (brainstorm) — ready for implementation plan

## Summary

Four related improvements to the Whatnot Business Manager, all on the **show
detail page** (`/shows/[id]`) and the **report page** (`/report`). The dashboard
is explicitly out of scope. **No database schema change and no backup change** —
every feature reuses existing tables and report fields.

1. **Bundle quantity** — define a bundle's component recipe once and apply it to
   multiple sale lines, instead of rebuilding the same components for each order.
2. **Order numbers in the bundle editor** — show each sale line's order number so
   identically-named, identically-priced lines (e.g. three "On Screen Bundle!"
   auctions) can be told apart.
3. **Units sold** — a total quantity-sold figure on each show's summary, on both
   the show page and the report page.
4. **Sortable Products tables** — click any column header to sort, on both the
   show page and the report page.

## Background / current behavior

- A bundle is a set of `bundle_components` rows keyed to a single
  `ledger_transactions.id` (one Whatnot order/listing). Revenue comes from that
  ledger line; cost is `Σ component.qty × item.unitCostCents`, resolved live at
  report time. This per-txn keying is deliberate (two identically-named bundles
  never merge). See `whatnot-app-business-rules` memory.
- On Whatnot a single on-screen bundle is auctioned repeatedly, so the **same
  recipe** appears as **several separate sale lines at different prices**
  (e.g. $7.50 / $5.92 / $4.99). Today the user must add a bundle and re-pick the
  same components once per line — tedious.
- The Products table (`src/app/shows/[id]/page.tsx`) already has a per-product
  `Qty` column, but it scrolls off-screen beside the Summary card, and there is
  no per-show units-sold total.
- Both the show Products table and the report's per-show tables are static
  server-rendered tables with no sorting.

## Feature 1 — Bundle quantity (Approach A: one recipe → many sale lines)

**Chosen model:** define the component recipe once, then check off every sale
line that is this bundle. Each checked order keeps its own real revenue; the
component cost applies to each order. Rejected: a numeric multiplier tied to one
line (it would miss the other orders' revenue when auction prices differ — the
normal case).

**Data model: unchanged.** `bundle_components` stays keyed per `ledger_txn_id`.
A "group" in the editor is purely a client-side convenience that expands to one
component set per checked line on save.

- **GET `/api/shows/[id]/bundles`** — `listShowSaleLines` (in
  `src/lib/db/bundles.ts`) additionally selects `order_id` for each sale line.
  The response `saleLines` items gain an `orderId: string | null` field.
- **`BundleEditor.tsx` (client):**
  - A bundle card model becomes `{ cid, lineIds: number[], components: Component[] }`
    (was a single `ledgerTxnId`).
  - **Load/grouping:** sale lines whose stored component sets are byte-identical
    (same item_id + qty multiset) are grouped into one card; the card's
    `lineIds` are those txn ids. Lines with a unique recipe each form their own
    single-line card. (Grouping identical recipes together is desired behavior —
    it is exactly "the same bundle sold N times".)
  - **Editing:** each card shows a checklist of the show's sale lines, each
    labeled `#<orderId-short> — $<price>`. A line may belong to at most one card;
    lines already used by another card are disabled (mirrors today's
    `usedLineIds` rule). Components are edited once per card as today.
  - **Cost/profit display** per card: `cost = Σ comp.qty × unit`, shown as
    `cost × N lines`; `revenue = Σ checked lines' amounts`;
    `profit = revenue − cost × N`.
  - **Save:** expand each card to one `BundleInput` per checked line
    (`{ ledgerTxnId, components }`) and PUT the flattened array. The existing
    replace-all `setShowBundles` is unchanged.
- **Report / Products table:** unchanged — each order still renders as its own
  bundle row with correct per-order revenue and the shared component cost. (No
  grouping of bundle rows in the report; per-order detail is intentional.)

## Feature 2 — Order numbers in the bundle editor

Covered by Feature 1's editor change: each sale line in the dropdown/checklist is
labeled with its `order_id` (a short suffix is fine for readability) alongside
the price. Sourced from `ledger_transactions.order_id`. No change beyond the
`order_id` field added to `listShowSaleLines`.

## Feature 3 — Units sold

- **Report builder** (`src/lib/calc/ledger-report.ts`): add
  `unitsSold: number` to `ReportShow` = `Σ products[].qty` for the show (each
  regular sale line counts its qty; each bundle order counts as 1). Add
  `unitsSold` to the report `totals` block (grand total across shows).
- **Show page** (`/shows/[id]`): render a `Units sold <N>` line in the Summary
  card, styled like the existing `Giveaways (21)` line.
- **Report page** (`/report`): add `Units sold <N>` to each show's summary line
  (the `Payout … ·` line) and a grand-total units-sold figure in the totals
  section.

## Feature 4 — Sortable Products tables

A single reusable **client** component renders the products table with
header-click sorting, used by both pages.

- **`src/components/ProductsTable.tsx` (client):**
  - Props: `products: ReportProductLine[]` and a `variant`/column config so the
    show page can include the **Avg/unit** column and the report page can omit it
    (the report table also uses smaller text — keep its styling via a variant).
  - Sortable keys: Product (string, locale compare), Qty, Unit cost, Cost,
    Revenue, Avg/unit (show page only), Profit.
  - Clicking a header sorts ascending; clicking the active header again toggles
    to descending. A small caret indicates the active column/direction. Default
    (no active sort) preserves the current order (Product A→Z from the builder).
  - **Null/unmapped handling:** lines with `unitCostCents == null` (unmapped)
    sort last regardless of direction when sorting by Unit cost or Avg/unit.
  - Bundle rows keep their `▸ bundle (N items)` indicator and component subtext
    (show page) exactly as today; sorting moves the whole row.
- The show page and report page replace their inline `<table>` markup with
  `<ProductsTable products={…} variant={…} />`.

## Testing

- **Unit (Vitest):**
  - Report builder: a show with N sale lines sharing a recipe yields N bundle
    rows with correct per-order revenue and shared cost; `unitsSold` equals the
    sum of product-line qty (including bundle orders); totals roll up
    `unitsSold`.
  - `listShowSaleLines` returns `orderId`.
  - A pure sort helper (extracted from `ProductsTable`) sorts by each key,
    toggles direction, and places null unit-cost rows last.
- **Manual:** in the seeded demo, open a show with repeated bundles, group lines
  into one card, save, and confirm the report shows one row per order with right
  totals; confirm Units sold and header sorting on both pages.

## Out of scope

- Dashboard changes (units sold / sorting there).
- Any schema migration, backup-table change, or stock drawdown for bundles
  (bundles remain profit-only per existing rules).
- Grouping/merging bundle rows in the report output.
