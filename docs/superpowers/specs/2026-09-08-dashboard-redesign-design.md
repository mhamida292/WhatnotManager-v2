# Dashboard Redesign — Design

**Status:** Approved by user, ready for implementation planning.
**Date:** 2026-09-08

## Context

The dashboard is nine unranked cards above a three-column table. Every figure
carries the same visual weight, so "Paid to bank" (a cash *transfer*), "Expenses"
(a cost that is subtracted from nothing) and "Units on hand" (a count) read as
peers. Nothing on the page relates any figure to any other.

Three concrete problems, all confirmed against the user's real data
(`whatnot-backup-2026-09-08.xlsx`, 18,718 ledger rows, 81 shows):

**Nothing reconciles.** Gross sales $61,718.49 becomes net profit $31,782.54 and
the page never says where the difference went. The pieces — COGS $27,537.09,
giveaway merchandise $1,335.67, labor $50.00 — are all present as separate cards
that the reader is left to combine.

**"Net profit" is not profit.** `dashboardSummary` returns `totalExpensesCents`
alongside `totalNetProfitCents`, and nothing subtracts the former from the
latter. The headline overstates actual business profit by $1,279.62.

**There is no time dimension.** Every figure is all-time cumulative. The user's
margin held at 55.0%, 55.7% and 56.2% through June, July and August, then fell to
43.6% in September — a 12-point drop the current dashboard cannot express, and
which is not a partial-month artifact because margin is a rate.

A fourth problem is data quality: 64 bundle sales carry **$0 cost** (~$522 of
missing COGS) because their product names were dismissed as "not a product"
while their components were never entered. `unmappedCount` reads 0, so nothing
on any page reports it.

## Goals

- The headline figure is profit after expenses, and the page shows how payout
  became that figure.
- Any month can be selected, and every flow figure follows it.
- Stock on hand is visible without leaving the dashboard.
- A costing gap large enough to move the numbers is surfaced when it exists.

## Non-goals

- **Reconstructing historical stock levels.** Inventory is a balance, not a
  flow; "stock as of 31 August" would require replaying the purchase/sale
  timeline. Out of scope — see Decision 2.
- **Per-product profit leaderboards.** The report already computes product lines;
  ranking them is a separate feature.
- **Sales-rate / reorder forecasting** ("≈5 shows of stock left"). Considered
  and cut; it needs a sales-velocity calculation that does not exist.
- **Week and custom ranges in the first cut.** The reused control offers them and
  the range parser supports them, so they will work — but month is the case the
  design targets and the one the tests will cover.
- **Wholesale as a first-class section.** It is 3.3% of revenue; the user asked
  for it to stay folded in rather than broken out.

## Decisions

Each records an alternative that was considered and rejected, so it is not
re-proposed during implementation.

### 1. Flows follow the period; balances stay current

Profit, payout, COGS, giveaways, labor, expenses, the shows list and the derived
rates all filter to the selected month. **Inventory and Cash withdrawn do not** —
they show today's position and are labelled as such.

Rejected: filtering everything. It is more consistent and it is worse. The user
took no payout in September, so a fully-filtered Cash withdrawn reads **$0.00** —
a true number that says something false about the business. A balance has no
period, and inventing one to satisfy a UI control misleads.

Rejected: filtering only the headline figures. The shows table would keep listing
all 77 rows beneath a headline counting 8, so the rows would visibly contradict
the total above them. That reads as a bug.

### 2. The range narrows a finished report; it is not pushed into the query

`buildLedgerReport` is unchanged. A new pure function takes the finished report
plus a range and returns a narrowed one.

This is a correctness decision, not a convenience one. Pooled costing computes a
**moving average** over the full purchase and sale timeline. If transactions were
filtered before that calculation, August's average unit cost would be computed as
though June and July never happened, and every COGS figure inside the window
would be wrong. Narrowing afterwards means each sale's cost was already locked
using complete history, and labor was already allocated per show, so the costs
come out right without special handling.

Rejected: pushing the range into `buildLedgerReport`. Faster in principle, but
pooled costing would still need a full-history pass, leaving two code paths
through the calculation that decides every COGS number in the app.

Cost accepted: the report always builds in full (~130 ms after the
`idx_lt_product_kind` index) and is then narrowed.

### 3. The period control is reused, not rebuilt

`PeriodFilter` (`src/components/expenses/PeriodFilter.tsx`), `rangeFromParams`
and `periodLabel` (`src/lib/ui/expense-range.ts`) already implement
Week / Month / All-time with a native month picker, driven by URL search params
and already tested. The dashboard uses them.

Rejected: a bespoke "This month / Last 30d" control. It would duplicate range
semantics that already exist and drift from them.

### 4. Absent range means today's behaviour, exactly

With no range the narrowing function returns the report unchanged, so the
all-time dashboard is byte-for-byte what it is now. This keeps every existing
report test meaningful as a regression net.

### 5. The costing gap is one line, only when it exists

A single amber line appears above the page when sales carry no cost, naming the
count and the estimated dollar impact, linking to Inventory. Absent when there is
nothing wrong.

Rejected: a permanent "Needs attention" panel. The user's objection was explicit
— a block that is always there becomes furniture, and its labels read as
commentary rather than data.

Rejected: dropping it entirely. The $522 gap reached $522 precisely because
nothing reported it.

### 6. Labels name things; captions carry figures

"Where the money went" becomes **Breakdown**. Its rows are nouns: Payout, COGS,
Giveaways, Labor, Show profit, Expenses, Business profit. Captions hold a number
("52.0% of payout"), never an explanation of the number above them.

## Layout

Header: title, period label, `PeriodFilter`.

1. **Headline row** — Business profit (large, with margin), Show profit (with
   per-show), Cash withdrawn (marked all-time).
2. **Breakdown** — payout down through each deduction to business profit, as
   proportional bars.
3. **Inventory** (value, units, products — current) and **Profit by show**
   (existing `ProfitChart`, dated axis), side by side.
4. **Shows** — date, payout, COGS, net, margin bar; negative nets tinted.

Removed: the flat nine-card row, "Sales mix" (wholesale is 3.3% and told the user
nothing), and the standing attention panel.

## New calculations

- **`businessProfitCents`** = `netCents − totalExpensesCents`.
- **Rates** — margin (`net ÷ payout`), profit per show (shows with sales), profit
  per unit. Division on existing figures; guard zero denominators.
- **`uncostedSales`** — sale rows whose product resolves to no inventory item
  *and* has no bundle components, with count and revenue. Estimated missing cost
  uses the average component cost of bundles that *do* have components ($8.16
  across 70 bundles in the user's data). This is the 5c warning's source, and the
  first thing in the app that would have caught the $522 drift.

## Period semantics

- Shows: `showDate` within range. The shows table, the Profit-by-show chart
  and every rate derived from shows all read the narrowed set, so the chart
  never plots a month the headline excludes.
- Expenses: `incurred_on` within range.
- Wholesale: invoice date within range, so a July invoice does not count toward
  August.
- Unmapped names, uncosted sales, payout failures: computed over the shows in
  range, so warnings match what is on screen.
- Inventory, Cash withdrawn: never filtered.

## Testing

The narrowing function is pure — report in, report out — so it is testable
without fixtures or a database:

- A range covering everything equals the unfiltered report.
- No range returns the identical object.
- A month selects only its shows and re-totals correctly.
- A month with no shows yields zeroes, not `NaN`.
- Expenses and wholesale filter on their own dates, not the show dates.
- `businessProfitCents` subtracts expenses; rates guard division by zero.
- `uncostedSales` finds a bundle sale with no components and ignores one with
  components — the real 64/$522 case.

Against the real backup, September must produce 8 shows, $8,913.43 payout,
$3,883.31 show profit, 43.6% margin, and Cash withdrawn must still read
$34,499.23.

## Known gaps

- **Comparison to the previous period** ("▲ 0.5 pts vs July") is drawn in the
  mockup and is not in this scope. It needs two report builds; worth doing, but
  after the filter works.
- **Estimated missing cost is an estimate.** It uses the average of costed
  bundles. It is labelled "~" and is a prompt to act, never a figure that enters
  any total.
- The dashboard's existing **"Inventory spend"** counts archived products
  ($31,161.45 against $8,444.80 for active ones). The new Inventory section uses
  active products only. The old card is removed, so the discrepancy disappears
  rather than being reconciled.
