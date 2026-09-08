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

  // periodLabel({}) reads "this week" -- but this page defaults to all time
  // when no params are present, so a fresh dashboard must not say "this week"
  // while showing lifetime figures.
  const label = sp.month || sp.week || sp.all ? periodLabel(sp) : "all time";
  const margin = (s: { netCents: number; payoutCents: number }) =>
    s.payoutCents <= 0 ? 0 : Math.max(0, Math.min(100, (s.netCents / s.payoutCents) * 100));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`${d.showCount} show${d.showCount === 1 ? "" : "s"} · ${label}`}
        action={<Suspense fallback={null}><PeriodFilter basePath="/" defaultMode="all" /></Suspense>}
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
