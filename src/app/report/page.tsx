import { dbForRequest } from "@/lib/auth/request";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { listRefunds, refundsTotalCents } from "@/lib/db/ledger-refunds";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";
import { showSessionLabel } from "@/lib/ui/show-label";
import { ProductsTable } from "@/components/ProductsTable";
import { RefundsCard } from "@/components/report/RefundsCard";
import { PooledShowDetail } from "@/components/report/PooledShowDetail";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const db = await dbForRequest();
  const rep = buildLedgerReport(db);
  const nonShows = rep.shows.filter((s) => s.saleCount === 0);
  const nonShowNetCents = nonShows.reduce((a, s) => a + s.netCents, 0);
  const refunds = listRefunds(db);
  const refundsTotal = refundsTotalCents(db);
  return (
    <div className="space-y-6">
      <PageHeader title="Profit report" subtitle="Full breakdown by show" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat
          label="Revenue"
          value={<Money cents={rep.totals.revenueCents} />}
          sub={<>Whatnot <Money cents={rep.totals.revenueCents - rep.wholesale.paidRevenueCents} /> · Wholesale <Money cents={rep.wholesale.paidRevenueCents} /></>}
        />
        <Stat label="Units sold" value={rep.totals.unitsSold} />
        <Stat label="COGS" value={<Money cents={rep.totals.cogsCents} />} />
        <Stat label="Net profit so far" value={<Money cents={rep.totals.netCents} />} />
      </div>

      {refunds.length > 0 && (
        <a href="#refunds" className="inline-flex w-fit items-center gap-1 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-brand-700 shadow-soft hover:bg-slate-50">
          ↓ Refunds (<Money cents={refundsTotal} /> · {refunds.length})
        </a>
      )}

      {rep.unmappedCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {rep.unmappedCount} unmapped product(s) counted at $0 cost: {rep.unmappedNames.join(", ")}. Map them on the Inventory page for accurate profit.
        </div>
      )}

      {rep.shows.length === 0 && <p className="text-slate-500">No ledger imported yet. Import your Whatnot ledger on the Shows page.</p>}

      {rep.shows.filter((s) => s.saleCount > 0).map((s) => (
        <Card key={s.showId} title={<div className="flex justify-between"><span>{showSessionLabel(s)}</span><span className="normal-case">Net: <Money cents={s.netCents} /></span></div>}>
          {rep.pool ? <PooledShowDetail show={s} /> : <ProductsTable products={s.products} variant="report" />}
          <div className="mt-2 text-xs text-slate-500">
            Units sold {s.unitsSold} ·{" "}
            Payout <Money cents={s.payoutCents} /> ·{" "}
            Giveaways {s.giveawayCount} → <Money cents={-s.giveawayCostCents} />{s.giveawayUnallocated && <span className="ml-1 text-amber-700">(not entered)</span>} ·{" "}
            Tips <Money cents={s.tipTotalCents} /> · Bonus <Money cents={s.bonusTotalCents} /> ·
            Other <Money cents={s.otherTotalCents} /> · Shipping <Money cents={s.shippingSuppliesCents} /> · Labor <Money cents={s.laborCents} />
          </div>
        </Card>
      ))}

      {nonShows.length > 0 && (
        <Card title={<div className="flex justify-between"><span>Non-show activity ({nonShows.length})</span><span className="normal-case">Net: <Money cents={nonShowNetCents} /></span></div>}>
          <p className="text-sm text-slate-500">Refunds, fees, and claims on dates with no sales. Counted in your totals above; itemized refunds are listed below.</p>
        </Card>
      )}

      <div id="refunds" className="scroll-mt-20">
        <RefundsCard refunds={refunds} totalCents={refundsTotal} />
      </div>

      {rep.wholesale.invoices.length > 0 && (
        <Card title={<div className="flex justify-between"><span>Wholesale</span><span className="normal-case">Net: <Money cents={rep.wholesale.paidProfitCents} /></span></div>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Invoice</th>
                  <th className="pb-2 pr-4">Customer</th>
                  <th className="pb-2 pr-4 text-right">Qty</th>
                  <th className="pb-2 pr-4 text-right">Revenue</th>
                  <th className="pb-2 pr-4 text-right">COGS</th>
                  <th className="pb-2 text-right">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rep.wholesale.invoices.map((inv) => (
                  <tr key={inv.invoiceId} className={inv.paid ? "" : "text-slate-400"}>
                    <td className="py-1.5 pr-4">{inv.number}</td>
                    <td className="py-1.5 pr-4">{inv.customer ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-right">{inv.qty}</td>
                    <td className="py-1.5 pr-4 text-right"><Money cents={inv.revenueCents} /></td>
                    <td className="py-1.5 pr-4 text-right"><Money cents={inv.cogsCents} /></td>
                    <td className="py-1.5 text-right">
                      {inv.paid ? <Money cents={inv.profitCents} /> : <span className="italic">— unpaid —</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Owed to you (unpaid): <Money cents={rep.wholesale.owedToYouCents} />
          </div>
        </Card>
      )}
    </div>
  );
}
