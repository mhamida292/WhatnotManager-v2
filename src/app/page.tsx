import Link from "next/link";
import { dbForRequest } from "@/lib/auth/request";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { dashboardSummary } from "@/lib/calc/dashboard";
import { qtyRemaining, listItems } from "@/lib/db/inventory";
import { Money } from "@/components/Money";
import { ProfitChart } from "@/components/ProfitChart";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { showSessionLabel } from "@/lib/ui/show-label";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const db = await dbForRequest();
  const d = dashboardSummary(db);
  const rep = buildLedgerReport(db);
  const unitsOnHand = listItems(db).reduce((s, i) => s + qtyRemaining(db, i.id), 0);

  const shows = [...rep.shows].sort((a, b) => a.showDate.localeCompare(b.showDate));
  const realShows = shows.filter((s) => s.saleCount > 0);
  const nonShows = shows.filter((s) => s.saleCount === 0);
  const nonShowNetCents = nonShows.reduce((a, s) => a + s.netCents, 0);
  const nonShowPayoutCents = nonShows.reduce((a, s) => a + s.payoutCents, 0);
  const points = realShows.map((s) => ({
    label: s.dateHasMultipleSessions ? `${s.showDate} #${s.sessionSeq + 1}` : s.showDate,
    valueCents: s.netCents,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Profit across all your Whatnot shows" />

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Net profit · {realShows.length} show{realShows.length === 1 ? "" : "s"}
          </h2>
          <div className="text-2xl font-semibold"><Money cents={d.totalNetProfitCents} /></div>
        </div>
        <div className="mt-3"><ProfitChart points={points} /></div>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Gross sales" value={<Money cents={d.grossSalesCents} />} />
        <Stat label="Total payout" value={<Money cents={d.totalPayoutCents} />} />
        <Stat label="Paid to bank" value={<Money cents={d.paidToBankCents} />} />
        <Stat label="Inventory spend" value={<Money cents={d.netInventorySpendCents} />} />
        <Stat label="Expenses" value={<Money cents={d.totalExpensesCents} />} />
        <Stat label="Units on hand" value={unitsOnHand} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Show breakdown</h2>
        <DataTable head={<>
          <th className="px-4 py-2">Show</th>
          <th className="px-4 py-2">Payout</th>
          <th className="px-4 py-2">COGS</th>
          <th className="px-4 py-2 text-right">Net</th>
        </>}>
          {realShows.length === 0 && nonShows.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-3 text-slate-500">
              No shows yet. Import your Whatnot ledger on the Shows page.
            </td></tr>
          )}
          {[...realShows].reverse().map((s) => (
            <tr key={s.showId} className="border-t border-line hover:bg-slate-50">
              <td className="px-4 py-2">
                <Link href={`/shows/${s.showId}`} className="font-medium text-brand-700 hover:underline">
                  {showSessionLabel(s)}
                </Link>
              </td>
              <td className="px-4 py-2"><Money cents={s.payoutCents} /></td>
              <td className="px-4 py-2"><Money cents={-s.cogsCents} /></td>
              <td className="px-4 py-2 text-right"><Money cents={s.netCents} /></td>
            </tr>
          ))}
          {nonShows.length > 0 && (
            <tr className="border-t border-line bg-slate-50 text-slate-500">
              <td className="px-4 py-2 italic">
                <Link href="/report#refunds" className="hover:underline">Non-show activity (refunds, fees, claims) · {nonShows.length}</Link>
              </td>
              <td className="px-4 py-2"><Money cents={nonShowPayoutCents} /></td>
              <td className="px-4 py-2">$0.00</td>
              <td className="px-4 py-2 text-right"><Money cents={nonShowNetCents} /></td>
            </tr>
          )}
        </DataTable>
      </div>
    </div>
  );
}
