import type { DB } from "@/lib/db/connection";
import { totalExpensesCents } from "@/lib/db/expenses";
import type { DateRange } from "@/lib/db/expenses";
import { netInventorySpend } from "./inventory-spend";
import { buildLedgerReport } from "./ledger-report";
import { narrowReportToRange } from "./report-range";
import { itemSpendCents } from "@/lib/db/purchases";

export interface DashboardSummary {
  grossSalesCents: number;
  totalPayoutCents: number;
  paidToBankCents: number;
  totalNetProfitCents: number;
  netInventorySpendCents: number;
  totalExpensesCents: number;
  totalLaborCents: number;
  unallocatedLaborCents: number;
  businessProfitCents: number;   // net profit after expenses -- the real figure
  marginPct: number;             // net / payout, 0-100, one decimal
  profitPerShowCents: number;
  profitPerUnitCents: number;
  showCount: number;             // shows with sales, inside the period
}

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
