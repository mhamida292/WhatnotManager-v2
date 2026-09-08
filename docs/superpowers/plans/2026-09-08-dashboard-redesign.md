# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard answer "how much did I make, where did it go, and is it getting better" for any month, with profit stated after expenses.

**Architecture:** `buildLedgerReport` is left untouched. A new pure function `narrowReportToRange` takes the finished report and a `DateRange` and returns a narrowed report; `dashboardSummary` gains an optional range, subtracts expenses to produce business profit, and derives margin/per-show/per-unit rates. The page reuses the Expenses page's `PeriodFilter` and `rangeFromParams`. A new `uncostedSales` calculation feeds a single amber line that appears only when sales carry no cost.

**Tech Stack:** Next.js 15.5 App Router, React 19, better-sqlite3, TypeScript, Vitest 4, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-08-dashboard-redesign-design.md`

## Global Constraints

- All money is **integer cents**. Rates (margin, per-unit) are the only real numbers, and are computed for display only — never stored, never fed back into a total.
- **Never push a date range into `buildLedgerReport`.** Pooled costing is a moving average over the full purchase/sale timeline; filtering before it runs makes every COGS figure in the window wrong. The range narrows a *finished* report. This is Decision 2 of the spec and is not negotiable.
- **A missing range must return the report unchanged**, so the all-time dashboard is byte-for-byte what it is today and existing report tests stay a regression net.
- **Inventory and Cash withdrawn are never filtered.** They are balances. A fully-filtered Cash withdrawn reads $0.00 for September, which is true and misleading.
- Guard every division: a month with no shows must yield `0`, never `NaN` or `Infinity`.
- Labels are nouns. Captions carry a figure, not an explanation of the figure above them.
- Run `npm test` (not `npx vitest`) — it is `vitest run`.
- Do **not** add period-over-period comparison ("▲ 0.5 pts vs July"). It is drawn in the mockups and explicitly out of scope.

---

### Task 1: `narrowReportToRange` — the period filter

**Files:**
- Create: `src/lib/calc/report-range.ts`
- Modify: `src/lib/calc/ledger-report.ts` (add `invoiceDate` to wholesale invoices)
- Test: `tests/lib/calc/report-range.test.ts`

**Interfaces:**
- Consumes: `LedgerReport`, `ReportShow`, `WholesaleInvoiceLine` from `@/lib/calc/ledger-report`; `DateRange` from `@/lib/db/expenses`.
- Produces: `narrowReportToRange(report: LedgerReport, range?: DateRange): LedgerReport`.

Wholesale invoices currently carry no date, so they cannot be filtered. Adding the field changes no behaviour — nothing reads it yet.

- [ ] **Step 1: Add `invoiceDate` to the wholesale invoice shape**

In `src/lib/calc/ledger-report.ts`, add to the `WholesaleInvoiceLine` interface, after `number: string;`:

```ts
  invoiceDate: string | null;   // invoices.invoice_date; null on older rows
```

Change the wholesale query (currently `"SELECT id, customer, paid FROM invoices WHERE direction='sale' AND status='posted' ORDER BY id DESC"`) to:

```ts
  const saleInvoices = db.prepare(
    "SELECT id, customer, paid, invoice_date AS invoiceDate FROM invoices WHERE direction='sale' AND status='posted' ORDER BY id DESC"
  ).all() as { id: number; customer: string | null; paid: number; invoiceDate: string | null }[];
```

and add `invoiceDate: inv.invoiceDate,` to the object returned by `saleInvoices.map(...)`, immediately after `number: invoiceNumber(inv.id),`.

- [ ] **Step 2: Write the failing test**

Create `tests/lib/calc/report-range.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { narrowReportToRange } from "@/lib/calc/report-range";
import type { LedgerReport, ReportShow } from "@/lib/calc/ledger-report";

const show = (showDate: string, over: Partial<ReportShow> = {}): ReportShow => ({
  showId: Number(showDate.replace(/-/g, "").slice(4)), showDate, sessionSeq: 0,
  timeRange: "", dateHasMultipleSessions: false, products: [],
  giveawayTotalCents: 0, giveawayCount: 0, giveawayCostCents: 0, giveawayUnallocated: false,
  tipTotalCents: 0, bonusTotalCents: 0, otherTotalCents: 0,
  payoutCents: 1000, withdrawnToBankCents: 0, payoutFailureCents: 0,
  cogsCents: 400, shippingSuppliesCents: 0, laborCents: 100,
  netCents: 500, unitsSold: 10, saleCount: 5, ...over,
});

const report = (shows: ReportShow[], over: Partial<LedgerReport> = {}): LedgerReport => ({
  shows,
  giveawayUnitCents: 500,
  totals: {
    revenueCents: 0, cogsCents: 0, giveawayCostCents: 0, shippingSuppliesCents: 0,
    laborCents: 0, unallocatedLaborCents: 0, netCents: 0, withdrawnToBankCents: -9999,
    payoutFailureCents: 0, unitsSold: 0,
  },
  wholesale: { invoices: [], paidRevenueCents: 0, paidCogsCents: 0, paidProfitCents: 0, owedToYouCents: 0 },
  unmappedNames: [], unmappedCount: 0, unrecognizedPayoutMessages: [],
  ...over,
});

const july = { from: "2026-07-01", to: "2026-07-31" };

describe("narrowReportToRange", () => {
  it("returns the report untouched when there is no range", () => {
    const r = report([show("2026-06-10"), show("2026-07-10")]);
    expect(narrowReportToRange(r, undefined)).toBe(r);
    expect(narrowReportToRange(r, {})).toBe(r);
  });

  it("keeps only shows inside the range", () => {
    const r = report([show("2026-06-30"), show("2026-07-01"), show("2026-07-31"), show("2026-08-01")]);
    expect(narrowReportToRange(r, july).shows.map((s) => s.showDate))
      .toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("re-totals from the shows it kept", () => {
    const r = report([
      show("2026-07-05", { cogsCents: 400, giveawayCostCents: 50, laborCents: 100, netCents: 450, unitsSold: 10 }),
      show("2026-07-06", { cogsCents: 600, giveawayCostCents: 25, laborCents: 0, netCents: 375, unitsSold: 5 }),
      show("2026-08-01", { cogsCents: 999, netCents: 999, unitsSold: 99 }),
    ]);
    const t = narrowReportToRange(r, july).totals;
    expect(t.cogsCents).toBe(1000);
    expect(t.giveawayCostCents).toBe(75);
    expect(t.laborCents).toBe(100);
    expect(t.netCents).toBe(825);
    expect(t.unitsSold).toBe(15);
  });

  it("leaves withdrawnToBankCents alone — a balance has no period", () => {
    const r = report([show("2026-08-01")]);
    expect(narrowReportToRange(r, july).totals.withdrawnToBankCents).toBe(-9999);
  });

  it("yields zeroes, not NaN, for a month with no shows", () => {
    const t = narrowReportToRange(report([show("2026-08-01")]), july).totals;
    expect(t.netCents).toBe(0);
    expect(t.unitsSold).toBe(0);
    expect(Number.isNaN(t.cogsCents)).toBe(false);
  });

  it("filters wholesale on the invoice date, not the show dates", () => {
    const r = report([show("2026-07-05")], {
      wholesale: {
        invoices: [
          { invoiceId: 1, number: "INV-0001", invoiceDate: "2026-07-04", customer: null, paid: true, qty: 3, revenueCents: 3400, cogsCents: 3260, profitCents: 140 },
          { invoiceId: 2, number: "INV-0002", invoiceDate: "2026-08-04", customer: null, paid: true, qty: 1, revenueCents: 1000, cogsCents: 600, profitCents: 400 },
        ],
        paidRevenueCents: 4400, paidCogsCents: 3860, paidProfitCents: 540, owedToYouCents: 0,
      },
    });
    const w = narrowReportToRange(r, july).wholesale;
    expect(w.invoices.map((i) => i.number)).toEqual(["INV-0001"]);
    expect(w.paidRevenueCents).toBe(3400);
    expect(w.paidProfitCents).toBe(140);
  });

  it("recomputes revenue and unmapped names from the kept shows", () => {
    const line = (name: string, mapped: boolean, rev: number) =>
      ({ productName: name, itemId: mapped ? 1 : null, mapped, unitCostCents: null, qty: 1, costCents: 0, revenueCents: rev, profitCents: rev });
    const r = report([
      show("2026-07-05", { products: [line("Kept", false, 700)] }),
      show("2026-08-05", { products: [line("Dropped", false, 900)] }),
    ]);
    const n = narrowReportToRange(r, july);
    expect(n.totals.revenueCents).toBe(700);
    expect(n.unmappedNames).toEqual(["Kept"]);
    expect(n.unmappedCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/report-range.test.ts`
Expected: FAIL — cannot resolve `@/lib/calc/report-range`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/calc/report-range.ts`:

```ts
import type { LedgerReport, ReportShow } from "./ledger-report";
import type { DateRange } from "@/lib/db/expenses";

const inRange = (date: string, range: DateRange): boolean =>
  (!range.from || date >= range.from) && (!range.to || date <= range.to);

/** Narrow a finished report to a date range.
 *
 *  The range is applied AFTER the report is built, never inside it. Pooled
 *  costing is a moving average over the whole purchase/sale timeline, so
 *  filtering transactions first would price August as though June and July
 *  never happened. Because every sale's cost and every show's labor were
 *  already resolved against full history, selecting shows and re-totalling
 *  is all that is needed — and the costs stay right.
 *
 *  Balances are deliberately untouched: withdrawnToBankCents is money that has
 *  left the account, not a flow belonging to a month. Filtering it would show
 *  $0.00 for a month with no payout, which is true and tells the reader
 *  something false. */
export function narrowReportToRange(report: LedgerReport, range?: DateRange): LedgerReport {
  if (!range || (!range.from && !range.to)) return report;

  const shows = report.shows.filter((s) => inRange(s.showDate, range));
  const sum = (f: (s: ReportShow) => number) => shows.reduce((a, s) => a + f(s), 0);

  const invoices = report.wholesale.invoices.filter(
    (i) => i.invoiceDate != null && inRange(i.invoiceDate, range),
  );
  const paid = invoices.filter((i) => i.paid);
  const wholesale = {
    invoices,
    paidRevenueCents: paid.reduce((a, i) => a + i.revenueCents, 0),
    paidCogsCents: paid.reduce((a, i) => a + i.cogsCents, 0),
    paidProfitCents: paid.reduce((a, i) => a + i.profitCents, 0),
    owedToYouCents: invoices.filter((i) => !i.paid).reduce((a, i) => a + i.revenueCents, 0),
  };

  // Revenue mirrors buildLedgerReport: pooled sales when pooled costing is on,
  // otherwise the product lines. Wholesale that was PAID folds into the total.
  const showRevenue = shows.reduce(
    (a, s) => a + (s.pooledSales
      ? s.pooledSales.reduce((x, p) => x + p.amountCents, 0)
      : s.products.reduce((x, p) => x + p.revenueCents, 0)),
    0,
  );

  const unmapped = new Set<string>();
  for (const s of shows) {
    for (const p of s.products) if (!p.mapped && !p.isBundle) unmapped.add(p.productName);
  }

  return {
    ...report,
    shows,
    wholesale,
    totals: {
      ...report.totals,
      revenueCents: showRevenue + wholesale.paidRevenueCents,
      cogsCents: sum((s) => s.cogsCents) + wholesale.paidCogsCents,
      giveawayCostCents: sum((s) => s.giveawayCostCents),
      shippingSuppliesCents: sum((s) => s.shippingSuppliesCents),
      laborCents: sum((s) => s.laborCents),
      netCents: sum((s) => s.netCents) + wholesale.paidProfitCents,
      payoutFailureCents: sum((s) => s.payoutFailureCents),
      unitsSold: sum((s) => s.unitsSold),
      // withdrawnToBankCents and unallocatedLaborCents are intentionally carried
      // through unchanged -- see the doc comment above.
    },
    unmappedNames: [...unmapped].sort(),
    unmappedCount: unmapped.size,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calc/report-range.test.ts`
Expected: PASS — 7 tests.

Then run `npm test` and `npx tsc --noEmit`. Both must be clean; adding `invoiceDate` may break a fixture that builds a wholesale invoice literal, in which case add the field to that fixture.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calc/report-range.ts tests/lib/calc/report-range.test.ts src/lib/calc/ledger-report.ts
git commit -m "Add narrowReportToRange: filter a finished report to a period"
```

---

### Task 2: `uncostedSales` — the costing gap

**Files:**
- Create: `src/lib/calc/uncosted-sales.ts`
- Test: `tests/lib/calc/uncosted-sales.test.ts`

**Interfaces:**
- Consumes: `LedgerReport` (Task 1 leaves its shape unchanged apart from `invoiceDate`).
- Produces:
  - `interface UncostedSales { count: number; revenueCents: number; estimatedCostCents: number }`
  - `uncostedSales(report: LedgerReport): UncostedSales`

A sale carries no cost when its product resolves to no inventory item and it is not a bundle with components. In the report those appear as product lines with `mapped: false` and `isBundle` falsy. Bundles that *do* have components appear as separate lines with `isBundle: true` and a real `costCents`, and are used to estimate what the uncosted ones would have cost.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calc/uncosted-sales.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { uncostedSales } from "@/lib/calc/uncosted-sales";
import type { LedgerReport, ReportShow, ReportProductLine } from "@/lib/calc/ledger-report";

const line = (over: Partial<ReportProductLine>): ReportProductLine => ({
  productName: "X", itemId: null, mapped: false, unitCostCents: null,
  qty: 1, costCents: 0, revenueCents: 100, profitCents: 100, ...over,
});

const rep = (products: ReportProductLine[]): LedgerReport => ({
  shows: [{
    showId: 1, showDate: "2026-07-01", sessionSeq: 0, timeRange: "", dateHasMultipleSessions: false,
    products, giveawayTotalCents: 0, giveawayCount: 0, giveawayCostCents: 0, giveawayUnallocated: false,
    tipTotalCents: 0, bonusTotalCents: 0, otherTotalCents: 0, payoutCents: 0, withdrawnToBankCents: 0,
    payoutFailureCents: 0, cogsCents: 0, shippingSuppliesCents: 0, laborCents: 0, netCents: 0,
    unitsSold: 0, saleCount: 0,
  } as ReportShow],
  giveawayUnitCents: 500,
  totals: { revenueCents: 0, cogsCents: 0, giveawayCostCents: 0, shippingSuppliesCents: 0, laborCents: 0,
    unallocatedLaborCents: 0, netCents: 0, withdrawnToBankCents: 0, payoutFailureCents: 0, unitsSold: 0 },
  wholesale: { invoices: [], paidRevenueCents: 0, paidCogsCents: 0, paidProfitCents: 0, owedToYouCents: 0 },
  unmappedNames: [], unmappedCount: 0, unrecognizedPayoutMessages: [],
});

describe("uncostedSales", () => {
  it("counts sales with no cost attached", () => {
    const r = uncostedSales(rep([
      line({ productName: "Bundle A", qty: 2, revenueCents: 500 }),
      line({ productName: "Mapped", mapped: true, itemId: 1, costCents: 150 }),
    ]));
    expect(r.count).toBe(2);              // qty, not lines
    expect(r.revenueCents).toBe(500);
  });

  it("ignores a bundle that has components — it is already costed", () => {
    const r = uncostedSales(rep([
      line({ productName: "Bundle B", isBundle: true, mapped: true, costCents: 800, revenueCents: 1600 }),
    ]));
    expect(r.count).toBe(0);
    expect(r.estimatedCostCents).toBe(0);
  });

  it("estimates missing cost from the average of costed bundles", () => {
    const r = uncostedSales(rep([
      line({ productName: "Costed 1", isBundle: true, mapped: true, costCents: 600, qty: 1 }),
      line({ productName: "Costed 2", isBundle: true, mapped: true, costCents: 1000, qty: 1 }),
      line({ productName: "Uncosted", qty: 3 }),
    ]));
    // average costed bundle = (600 + 1000) / 2 = 800; 3 uncosted -> 2400
    expect(r.estimatedCostCents).toBe(2400);
  });

  it("estimates zero when there is no costed bundle to learn from", () => {
    expect(uncostedSales(rep([line({ qty: 5 })])).estimatedCostCents).toBe(0);
  });

  it("returns zeroes for a report with nothing uncosted", () => {
    expect(uncostedSales(rep([]))).toEqual({ count: 0, revenueCents: 0, estimatedCostCents: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/uncosted-sales.test.ts`
Expected: FAIL — cannot resolve `@/lib/calc/uncosted-sales`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calc/uncosted-sales.ts`:

```ts
import type { LedgerReport } from "./ledger-report";

export interface UncostedSales {
  count: number;               // units sold carrying no cost
  revenueCents: number;        // their revenue, booked as pure profit today
  estimatedCostCents: number;  // what they probably cost; a prompt, never a total
}

/** Sales the report priced at $0 because nothing told it what they cost: a
 *  product that resolves to no inventory item and is not a bundle with
 *  components entered.
 *
 *  These do not appear in `unmappedNames` when their name was dismissed, which
 *  is how a real workspace reached 64 such sales worth $584 of revenue with no
 *  warning anywhere. The estimate uses the average cost of bundles that DO have
 *  components — the closest evidence available — and exists to prompt a fix,
 *  never to enter a total. */
export function uncostedSales(report: LedgerReport): UncostedSales {
  let count = 0, revenueCents = 0;
  let costedBundles = 0, costedTotal = 0;

  for (const show of report.shows) {
    for (const p of show.products) {
      if (p.isBundle && p.costCents > 0) {
        costedBundles += 1;
        costedTotal += p.costCents;
      } else if (!p.mapped && !p.isBundle) {
        count += p.qty;
        revenueCents += p.revenueCents;
      }
    }
  }

  const average = costedBundles > 0 ? Math.round(costedTotal / costedBundles) : 0;
  return { count, revenueCents, estimatedCostCents: count * average };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calc/uncosted-sales.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/uncosted-sales.ts tests/lib/calc/uncosted-sales.test.ts
git commit -m "Add uncostedSales: find sales priced at zero and estimate the gap"
```

---

### Task 3: Dashboard summary — period, business profit, rates

**Files:**
- Modify: `src/lib/calc/dashboard.ts`
- Test: `tests/lib/calc/dashboard.test.ts`

**Interfaces:**
- Consumes: `narrowReportToRange` (Task 1); `totalExpensesCents(db, range?)` from `@/lib/db/expenses` (already accepts a range); `DateRange`.
- Produces: `dashboardSummary(db: DB, range?: DateRange): DashboardSummary`, with `DashboardSummary` gaining:
  - `businessProfitCents: number`
  - `marginPct: number` (0–100, one decimal, `0` when payout is 0)
  - `profitPerShowCents: number` (shows with `saleCount > 0`; `0` when none)
  - `profitPerUnitCents: number` (`0` when no units)
  - `showCount: number` (shows with sales, in range)

`paidToBankCents` and `netInventorySpendCents` keep reading unfiltered data — they are balances.

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/calc/dashboard.test.ts`:

```ts
describe("dashboardSummary — period and rates", () => {
  it("subtracts expenses to give business profit", () => {
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
${SALE("Earnings for selling a Mystery Dumpling #1", "$10.00", "9")}`));
    insertExpense(db, { description: "Mailers", type: "one_time", amountCents: 250, incurredOn: "2026-06-14" });

    const d = dashboardSummary(db);
    expect(d.totalNetProfitCents).toBe(1000);
    expect(d.totalExpensesCents).toBe(250);
    expect(d.businessProfitCents).toBe(750);
  });

  it("derives margin, per-show and per-unit", () => {
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
${SALE("Earnings for selling a Mystery Dumpling #1", "$10.00", "9")}`));

    const d = dashboardSummary(db);
    expect(d.marginPct).toBe(100);          // no costs on an unmapped sale
    expect(d.showCount).toBe(1);
    expect(d.profitPerShowCents).toBe(1000);
    expect(d.profitPerUnitCents).toBe(1000);
  });

  it("returns zeroes rather than NaN when the period has no shows", () => {
    const d = dashboardSummary(db, { from: "2030-01-01", to: "2030-01-31" });
    expect(d.totalNetProfitCents).toBe(0);
    expect(d.marginPct).toBe(0);
    expect(d.profitPerShowCents).toBe(0);
    expect(d.profitPerUnitCents).toBe(0);
    expect(d.showCount).toBe(0);
  });

  it("keeps balances unfiltered — cash and inventory spend ignore the period", () => {
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank","completed","PAYOUT","b"`));
    insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: null });

    const far = dashboardSummary(db, { from: "2030-01-01", to: "2030-01-31" });
    expect(far.paidToBankCents).toBe(53439);
    expect(far.netInventorySpendCents).toBe(5000);
  });
});
```

If `SALE`, `insertExpense` or `insertItem` are not already imported at the top of that file, add them — check the existing imports before assuming.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/dashboard.test.ts`
Expected: FAIL — `businessProfitCents` is undefined; `dashboardSummary` takes one argument.

- [ ] **Step 3: Write the implementation**

In `src/lib/calc/dashboard.ts`, add the imports:

```ts
import { narrowReportToRange } from "./report-range";
import type { DateRange } from "@/lib/db/expenses";
```

Add to the `DashboardSummary` interface:

```ts
  businessProfitCents: number;   // net profit after expenses -- the real figure
  marginPct: number;             // net / payout, 0-100, one decimal
  profitPerShowCents: number;
  profitPerUnitCents: number;
  showCount: number;             // shows with sales, inside the period
```

Replace the body of `dashboardSummary`:

```ts
export function dashboardSummary(db: DB, range?: DateRange): DashboardSummary {
  // The report is built in full, then narrowed. Never filter before building:
  // pooled costing averages over the whole timeline (see report-range.ts).
  const report = narrowReportToRange(buildLedgerReport(db), range);
  const itemCosts = (db.prepare("SELECT id FROM inventory_items").all() as { id: number }[]).map((r) => itemSpendCents(db, r.id));
  const netInventorySpendCents = netInventorySpend({ itemCostsCents: itemCosts });

  const totalPayoutCents = report.shows.reduce((sum, s) => sum + s.payoutCents, 0);
  const totalNetProfitCents = report.totals.netCents;
  // Expenses filter on their own date, not on show dates.
  const expenses = totalExpensesCents(db, range);
  const showCount = report.shows.filter((s) => s.saleCount > 0).length;

  // Every rate guards its denominator: an empty month must read 0, not NaN.
  const rate = (n: number, d: number) => (d === 0 ? 0 : n / d);

  return {
    grossSalesCents: report.totals.revenueCents,
    totalPayoutCents,
    // A balance, not a flow: never narrowed, so a month with no payout still
    // shows the money that has actually left the account.
    paidToBankCents: -report.totals.withdrawnToBankCents,
    totalNetProfitCents,
    businessProfitCents: totalNetProfitCents - expenses,
    marginPct: Math.round(rate(totalNetProfitCents, totalPayoutCents) * 1000) / 10,
    profitPerShowCents: Math.round(rate(totalNetProfitCents, showCount)),
    profitPerUnitCents: Math.round(rate(totalNetProfitCents, report.totals.unitsSold)),
    showCount,
    netInventorySpendCents,
    totalExpensesCents: expenses,
    totalLaborCents: report.totals.laborCents,
    unallocatedLaborCents: report.totals.unallocatedLaborCents,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` then `npx tsc --noEmit`.
Expected: PASS, no type output. Existing dashboard tests must still pass unchanged — `dashboardSummary(db)` with no range must behave exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/dashboard.ts tests/lib/calc/dashboard.test.ts
git commit -m "Dashboard summary: optional period, business profit, derived rates"
```

---

### Task 4: Make `PeriodFilter` reusable

**Files:**
- Modify: `src/components/expenses/PeriodFilter.tsx`
- Modify: `src/app/expenses/page.tsx` (pass the new prop)
- Test: `tests/lib/ui/period-filter-path.test.ts`

**Interfaces:**
- Produces: `PeriodFilter({ basePath }: { basePath?: string })`, defaulting to `"/expenses"` so the existing call site is unaffected.

The component hardcodes `/expenses` in its `go()` helper. The dashboard needs the same control pointing at `/`.

- [ ] **Step 1: Write the failing test**

The component is a client component with router hooks, so test the path-building rule as a pure function rather than rendering React. Create `tests/lib/ui/period-filter-path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { periodHref } from "@/lib/ui/expense-range";

describe("periodHref", () => {
  it("appends the query to the base path", () => {
    expect(periodHref("/expenses", "month=2026-07")).toBe("/expenses?month=2026-07");
    expect(periodHref("/", "month=2026-07")).toBe("/?month=2026-07");
  });

  it("returns the bare path when there is no query", () => {
    expect(periodHref("/expenses", "")).toBe("/expenses");
    expect(periodHref("/", "")).toBe("/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ui/period-filter-path.test.ts`
Expected: FAIL — `periodHref` is not exported.

- [ ] **Step 3: Add the helper**

Append to `src/lib/ui/expense-range.ts`:

```ts
/** Build a period URL for any page. Kept out of the component so the rule is
 *  testable without rendering React and a router. */
export function periodHref(basePath: string, query: string): string {
  return query ? `${basePath}?${query}` : basePath;
}
```

- [ ] **Step 4: Use it in the component**

In `src/components/expenses/PeriodFilter.tsx`:

- import it: change `import { currentIsoWeek } from "@/lib/ui/expense-range";` to
  `import { currentIsoWeek, periodHref } from "@/lib/ui/expense-range";`
- change the signature to `export function PeriodFilter({ basePath = "/expenses" }: { basePath?: string } = {}) {`
- replace `const go = (qs: string) => router.push(qs ? \`/expenses?${qs}\` : "/expenses");` with
  `const go = (qs: string) => router.push(periodHref(basePath, qs));`

Leave `src/app/expenses/page.tsx` as it is — the default keeps it working. (Do not add a prop there; the default is the point.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` then `npx tsc --noEmit`.
Expected: PASS, no type output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ui/expense-range.ts src/components/expenses/PeriodFilter.tsx tests/lib/ui/period-filter-path.test.ts
git commit -m "Let PeriodFilter target any page via basePath"
```

---

### Task 5: Rebuild the dashboard page

**Files:**
- Modify: `src/app/page.tsx` (whole page)
- Create: `src/components/dashboard/Breakdown.tsx`
- Test: `tests/lib/calc/breakdown.test.ts`

**Interfaces:**
- Consumes: `dashboardSummary(db, range)` and its new fields (Task 3); `narrowReportToRange` (Task 1); `uncostedSales` (Task 2); `PeriodFilter` with `basePath` (Task 4); `rangeFromParams`, `periodLabel` from `@/lib/ui/expense-range`; `inStockSummary` from `@/lib/calc/in-stock`; `ProfitChart`; `Money`; `Stat`; `Card`; `DataTable`.
- Produces: `breakdownRows(...)` from `Breakdown.tsx` — the proportional bar widths, extracted so the arithmetic is testable.

- [ ] **Step 1: Write the failing test for the bar geometry**

Create `tests/lib/calc/breakdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { breakdownRows } from "@/components/dashboard/Breakdown";

describe("breakdownRows", () => {
  const input = {
    payoutCents: 100000, cogsCents: 47000, giveawayCostCents: 2300,
    laborCents: 500, expensesCents: 2200, showProfitCents: 50200,
    businessProfitCents: 48000,
  };

  it("scales every bar against the payout", () => {
    const rows = breakdownRows(input);
    expect(rows.find((r) => r.label === "Payout")!.widthPct).toBe(100);
    expect(rows.find((r) => r.label === "COGS")!.widthPct).toBe(47);
    expect(rows.find((r) => r.label === "Business profit")!.widthPct).toBe(48);
  });

  it("keeps deduction amounts negative for display", () => {
    const rows = breakdownRows(input);
    expect(rows.find((r) => r.label === "COGS")!.amountCents).toBe(-47000);
    expect(rows.find((r) => r.label === "Payout")!.amountCents).toBe(100000);
  });

  it("does not divide by zero when a period has no payout", () => {
    const rows = breakdownRows({ ...input, payoutCents: 0 });
    for (const r of rows) expect(Number.isNaN(r.widthPct)).toBe(false);
    expect(rows.every((r) => r.widthPct >= 0)).toBe(true);
  });

  it("clamps a negative profit to a zero-width bar rather than a backwards one", () => {
    const rows = breakdownRows({ ...input, businessProfitCents: -500 });
    expect(rows.find((r) => r.label === "Business profit")!.widthPct).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/breakdown.test.ts`
Expected: FAIL — cannot resolve `@/components/dashboard/Breakdown`.

- [ ] **Step 3: Write the Breakdown component**

Create `src/components/dashboard/Breakdown.tsx`:

```tsx
import { Money } from "@/components/Money";

export interface BreakdownInput {
  payoutCents: number;
  cogsCents: number;
  giveawayCostCents: number;
  laborCents: number;
  showProfitCents: number;
  expensesCents: number;
  businessProfitCents: number;
}

export interface BreakdownRow {
  label: string;
  amountCents: number;   // signed: deductions are negative
  widthPct: number;      // 0-100, proportional to payout
  color: string;
  strong?: boolean;
}

/** Bar widths for the breakdown, as a share of payout. Extracted from the
 *  component so the arithmetic is testable: a period with no payout must not
 *  divide by zero, and a negative profit must not render a backwards bar. */
export function breakdownRows(i: BreakdownInput): BreakdownRow[] {
  const pct = (c: number) =>
    i.payoutCents <= 0 ? 0 : Math.max(0, Math.min(100, (Math.abs(c) / i.payoutCents) * 100));

  return [
    { label: "Payout", amountCents: i.payoutCents, widthPct: pct(i.payoutCents), color: "bg-teal-700" },
    { label: "COGS", amountCents: -i.cogsCents, widthPct: pct(i.cogsCents), color: "bg-red-500" },
    { label: "Giveaways", amountCents: -i.giveawayCostCents, widthPct: pct(i.giveawayCostCents), color: "bg-orange-500" },
    { label: "Labor", amountCents: -i.laborCents, widthPct: pct(i.laborCents), color: "bg-violet-500" },
    { label: "Show profit", amountCents: i.showProfitCents, widthPct: pct(Math.max(i.showProfitCents, 0)), color: "bg-emerald-400" },
    { label: "Expenses", amountCents: -i.expensesCents, widthPct: pct(i.expensesCents), color: "bg-yellow-700" },
    { label: "Business profit", amountCents: i.businessProfitCents, widthPct: pct(Math.max(i.businessProfitCents, 0)), color: "bg-emerald-500", strong: true },
  ];
}

export function Breakdown(props: BreakdownInput) {
  const rows = breakdownRows(props);
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Breakdown</h2>
      <div className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[7.5rem_1fr_6.5rem] items-center gap-3 text-sm">
            <span className={r.strong ? "font-semibold" : "text-slate-600"}>{r.label}</span>
            <span className="h-3.5 rounded bg-slate-100">
              <span className={`block h-full rounded ${r.color}`} style={{ width: `${r.widthPct}%` }} />
            </span>
            <span className={`text-right tabular-nums ${r.strong ? "font-semibold" : ""}`}>
              <Money cents={r.amountCents} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calc/breakdown.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Rebuild the page**

Replace `src/app/page.tsx` entirely:

```tsx
import Link from "next/link";
import { Suspense } from "react";
import { dbForRequest } from "@/lib/auth/request";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { narrowReportToRange } from "@/lib/calc/report-range";
import { uncostedSales } from "@/lib/calc/uncosted-sales";
import { dashboardSummary } from "@/lib/calc/dashboard";
import { inStockSummary } from "@/lib/calc/in-stock";
import { rangeFromParams, periodLabel } from "@/lib/ui/expense-range";
import { qtyRemaining, listItems } from "@/lib/db/inventory";
import { Money } from "@/components/Money";
import { ProfitChart } from "@/components/ProfitChart";
import { Breakdown } from "@/components/dashboard/Breakdown";
import { PeriodFilter } from "@/components/expenses/PeriodFilter";
import { Stat } from "@/components/ui/Stat";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { showSessionLabel } from "@/lib/ui/show-label";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  // Unlike Expenses, the dashboard defaults to all time -- the lifetime figure
  // is the one people open it for.
  const range = rangeFromParams(sp);
  const db = await dbForRequest();

  const d = dashboardSummary(db, range);
  const rep = narrowReportToRange(buildLedgerReport(db), range);
  const gap = uncostedSales(rep);

  // Inventory is a balance: always current, never narrowed.
  const items = listItems(db).filter((i) => i.archivedAt == null);
  const stock = rep.pool
    ? { units: rep.pool.unitsOnHand, valueCents: rep.pool.valueOnHandCents, productsInStock: items.length, totalProducts: items.length }
    : inStockSummary(items.map((i) => ({ remaining: qtyRemaining(db, i.id), unitCostCents: i.unitCostCents })));

  const shows = [...rep.shows].sort((a, b) => a.showDate.localeCompare(b.showDate));
  const realShows = shows.filter((s) => s.saleCount > 0);
  const points = realShows.map((s) => ({
    label: s.dateHasMultipleSessions ? `${s.showDate} #${s.sessionSeq + 1}` : s.showDate,
    valueCents: s.netCents,
  }));

  const label = periodLabel(sp);
  const margin = (s: { netCents: number; payoutCents: number }) =>
    s.payoutCents <= 0 ? 0 : Math.max(0, Math.min(100, (s.netCents / s.payoutCents) * 100));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`${d.showCount} show${d.showCount === 1 ? "" : "s"} · ${label}`}
        action={<Suspense fallback={null}><PeriodFilter basePath="/" /></Suspense>}
      />

      {gap.count > 0 && (
        <Link href="/inventory" className="block rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 hover:bg-amber-100">
          {gap.count} sale(s) have no cost attached — about <Money cents={gap.estimatedCostCents} /> missing from COGS.
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Business profit"
          value={<span className="text-3xl font-semibold"><Money cents={d.businessProfitCents} /></span>}
          sub={`${d.marginPct}% of payout`} />
        <Stat label="Show profit" value={<Money cents={d.totalNetProfitCents} />}
          sub={<><Money cents={d.profitPerShowCents} /> per show</>} />
        <Stat label="Cash withdrawn" value={<Money cents={d.paidToBankCents} />} sub="all time" />
      </div>

      <Breakdown
        payoutCents={d.totalPayoutCents}
        cogsCents={rep.totals.cogsCents}
        giveawayCostCents={rep.totals.giveawayCostCents}
        laborCents={rep.totals.laborCents}
        showProfitCents={d.totalNetProfitCents}
        expensesCents={d.totalExpensesCents}
        businessProfitCents={d.businessProfitCents}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inventory</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div><div className="text-xs text-slate-500">Value</div><div className="text-lg font-semibold"><Money cents={stock.valueCents} /></div></div>
            <div><div className="text-xs text-slate-500">Units</div><div className="text-lg font-semibold">{stock.units}</div></div>
            <div><div className="text-xs text-slate-500">Products</div><div className="text-lg font-semibold">{stock.productsInStock}</div></div>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Profit by show</h2>
          <div className="mt-3"><ProfitChart points={points} /></div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Shows</h2>
        <DataTable head={<>
          <th className="px-4 py-2">Show</th>
          <th className="px-4 py-2">Payout</th>
          <th className="px-4 py-2">COGS</th>
          <th className="px-4 py-2 text-right">Net</th>
          <th className="px-4 py-2">Margin</th>
        </>}>
          {realShows.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-3 text-slate-500">
              No shows in this period.
            </td></tr>
          )}
          {[...realShows].reverse().map((s) => (
            <tr key={s.showId} className={`border-t border-line hover:bg-slate-50 ${s.netCents < 0 ? "bg-red-50/60" : ""}`}>
              <td className="px-4 py-2">
                <Link href={`/shows/${s.showId}`} className="font-medium text-brand-700 hover:underline">
                  {showSessionLabel(s)}
                </Link>
              </td>
              <td className="px-4 py-2"><Money cents={s.payoutCents} /></td>
              <td className="px-4 py-2"><Money cents={-s.cogsCents} /></td>
              <td className="px-4 py-2 text-right"><Money cents={s.netCents} /></td>
              <td className="px-4 py-2">
                <span className="block h-1.5 w-16 rounded bg-slate-100">
                  <span className={`block h-full rounded ${s.netCents < 0 ? "bg-red-500" : "bg-emerald-500"}`}
                    style={{ width: `${margin(s)}%` }} />
                </span>
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
    </div>
  );
}
```

Note `rep.pool` still exists on the report — pooled workspaces report units and value from the pool, per-SKU workspaces from `inStockSummary`. If `PoolSummary` lacks `productsInStock`, the fallback above uses the item count, which is what the old page did.

- [ ] **Step 6: Verify the whole suite, types and build**

Run: `npm test` — all files pass.
Run: `npx tsc --noEmit` — no output.
Run: `npm run build` — completes, `/` still listed in the route table.

- [ ] **Step 7: Verify against real data**

Start the app against a workspace with real data and check `/?month=2026-09` reports **8 shows, $8,913.43 payout, $3,883.31 show profit, 43.6% margin**, and that **Cash withdrawn still reads the all-time figure**, not $0.00. Then check `/` with no params matches the all-time numbers the app showed before this plan.

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx src/components/dashboard/Breakdown.tsx tests/lib/calc/breakdown.test.ts
git commit -m "Rebuild the dashboard: period filter, breakdown, inventory, margins"
```

---

## Self-Review

**Spec coverage** — every section maps to a task:

| Spec section | Task |
|---|---|
| Decision 1 (flows filter, balances stay) | 1 (shows/wholesale narrowed, `withdrawnToBankCents` carried through), 3 (`paidToBankCents`, inventory spend unfiltered) |
| Decision 2 (narrow a finished report) | 1 |
| Decision 3 (reuse the period control) | 4, 5 |
| Decision 4 (no range = unchanged) | 1 Step 2 first test; 3 Step 4 regression check |
| Decision 5 (one amber line) | 2, 5 |
| Decision 6 (labels are nouns) | 5 (`Breakdown`, `Inventory`, `Shows`, `Profit by show`) |
| Layout (headline / breakdown / inventory + chart / shows) | 5 |
| New calcs: business profit, rates, `uncostedSales` | 3, 2 |
| Period semantics (shows, expenses, wholesale, warnings) | 1, 3 |
| Testing requirements | 1, 2, 3, 5 + real-data check at 5 Step 7 |
| Non-goal: period comparison | Global Constraints forbid it |
| Non-goal: historical stock | Inventory never narrowed (1, 3, 5) |

**Type consistency** — `DateRange` (from `@/lib/db/expenses`) is the range type in Tasks 1, 3 and 5. `narrowReportToRange` returns `LedgerReport`, which is what Task 5 passes to `uncostedSales`. `DashboardSummary`'s new fields are defined in Task 3 and consumed by name in Task 5. `breakdownRows`/`BreakdownInput` are defined in Task 5 and used only there.

**Known wrinkles flagged in place:**
- Task 1 Step 5 warns that adding `invoiceDate` may break a wholesale fixture.
- Task 3 Step 1 warns to check the existing imports in `dashboard.test.ts` before adding to it.
- Task 5 Step 5 notes the pooled-vs-per-SKU inventory fallback.
