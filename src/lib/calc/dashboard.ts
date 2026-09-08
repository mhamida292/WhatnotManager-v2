import type { DB } from "@/lib/db/connection";
import { totalExpensesCents } from "@/lib/db/expenses";
import { netInventorySpend } from "./inventory-spend";
import { buildLedgerReport } from "./ledger-report";
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
}

export function dashboardSummary(db: DB): DashboardSummary {
  // Profit comes from the ledger report (the source of truth), so the dashboard
  // and the /report page always agree. This properly subtracts ledger COGS for
  // imported shows, which the old per-show-line-items path could not.
  const report = buildLedgerReport(db);
  const itemCosts = (db.prepare("SELECT id FROM inventory_items").all() as { id: number }[]).map((r) => itemSpendCents(db, r.id));
  const netInventorySpendCents = netInventorySpend({ itemCostsCents: itemCosts });
  return {
    grossSalesCents: report.totals.revenueCents,
    // Everything Whatnot paid out across shows: sales + tips + bonuses + adjustments.
    totalPayoutCents: report.shows.reduce((sum, s) => sum + s.payoutCents, 0),
    // Total balance withdrawn to the user's bank (transfer, not income/expense).
    // report total is signed/negative; present as a positive amount.
    paidToBankCents: -report.totals.withdrawnToBankCents,
    totalNetProfitCents: report.totals.netCents,
    netInventorySpendCents,
    totalExpensesCents: totalExpensesCents(db),
    totalLaborCents: report.totals.laborCents,
    unallocatedLaborCents: report.totals.unallocatedLaborCents,
  };
}
