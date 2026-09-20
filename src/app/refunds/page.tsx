import { dbForRequest } from "@/lib/auth/request";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { listRefunds, refundsTotalCents } from "@/lib/db/ledger-refunds";
import { Money } from "@/components/Money";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { PageHeader } from "@/components/ui/PageHeader";
import { RefundsCard } from "@/components/report/RefundsCard";
import { summariseRefunds } from "@/lib/calc/refund-summary";

export const dynamic = "force-dynamic";

export default async function RefundsPage() {
  const db = await dbForRequest();
  const refunds = listRefunds(db);
  const total = refundsTotalCents(db);
  const s = summariseRefunds(refunds);

  // Dates that carry refunds/fees/claims but no sales -- the same story as the
  // itemised list, at day granularity.
  const rep = buildLedgerReport(db);
  const nonShows = rep.shows.filter((x) => x.saleCount === 0);
  const nonShowNetCents = nonShows.reduce((a, x) => a + x.netCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Refunds" subtitle="Money returned to buyers, and days with no sales" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total refunded" value={<Money cents={total} />}
          sub={`${refunds.length} refund${refunds.length === 1 ? "" : "s"}`} />
        <Stat label="Product refunds" value={<Money cents={s.productCents} />}
          sub={`${s.productCount} of ${refunds.length}`} />
        <Stat label="Return shipping" value={<Money cents={s.shippingCents} />}
          sub={`${s.shippingCount} of ${refunds.length}`} />
        <Stat label="Most refunded" value={s.topProduct ?? "—"}
          sub={s.topProduct ? <><Money cents={s.topProductCents} /> over {s.topProductCount}</> : "no product refunds"} />
      </div>

      {refunds.length === 0
        ? <p className="text-slate-500">No refunds in the imported ledger.</p>
        : <RefundsCard refunds={refunds} totalCents={total} />}

      {nonShows.length > 0 && (
        <Card title={<div className="flex justify-between"><span>Non-show activity ({nonShows.length})</span><span className="normal-case">Net: <Money cents={nonShowNetCents} /></span></div>}>
          <p className="text-sm text-slate-500">
            Refunds, fees, and claims landing on dates with no sales. Counted in your dashboard totals.
          </p>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {nonShows.map((x) => (
              <li key={x.showId} className="flex justify-between gap-3 border-b border-line py-1">
                <span className="text-slate-600">{x.showDate}</span>
                <span><Money cents={x.netCents} /></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
