import { dbForRequest } from "@/lib/auth/request";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { listRefunds } from "@/lib/db/ledger-refunds";
import { Money } from "@/components/Money";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { PageHeader } from "@/components/ui/PageHeader";
import { RefundsCard } from "@/components/report/RefundsCard";
import { summariseRefunds } from "@/lib/calc/refund-summary";
import { describeActivity } from "@/lib/calc/activity-label";

export const dynamic = "force-dynamic";

export default async function RefundsPage() {
  const db = await dbForRequest();
  const refunds = listRefunds(db);
  const s = summariseRefunds(refunds);
  const cancellations = refunds.filter((r) => r.isCancellation);
  const returns = refunds.filter((r) => !r.isCancellation);

  // Dates that carry refunds/fees/claims but no sales -- the same story as the
  // itemised list, at day granularity.
  const rep = buildLedgerReport(db);
  const nonShowShows = rep.shows.filter((x) => x.saleCount === 0);
  const nonShowNetCents = nonShowShows.reduce((a, x) => a + x.netCents, 0);
  // A date and an amount say nothing about what happened; name each day from
  // the rows behind it.
  const activityRows = db.prepare(
    "SELECT show_id AS showId, kind, message FROM ledger_transactions WHERE show_id IS NOT NULL"
  ).all() as { showId: number; kind: string; message: string }[];
  const byShow = new Map<number, { kind: string; message: string }[]>();
  for (const r of activityRows) {
    if (!byShow.has(r.showId)) byShow.set(r.showId, []);
    byShow.get(r.showId)!.push({ kind: r.kind, message: r.message ?? "" });
  }
  const nonShows = nonShowShows.map((x) => ({
    showId: x.showId, showDate: x.showDate, netCents: x.netCents,
    what: describeActivity(byShow.get(x.showId) ?? []),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Refunds" subtitle="Money returned to buyers, and days with no sales" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Refunded" value={<Money cents={s.productCents} />}
          sub={`${s.productCount} returned order${s.productCount === 1 ? "" : "s"}`} />
        <Stat label="Cancelled" value={<Money cents={s.cancelledCents} />}
          sub={`${s.cancelledCount} order${s.cancelledCount === 1 ? "" : "s"} never shipped`} />
        <Stat label="Return shipping" value={<Money cents={s.shippingCents} />}
          sub={`${s.shippingCount} deduction${s.shippingCount === 1 ? "" : "s"}`} />
        <Stat label="Most refunded" value={s.topProduct ?? "—"}
          sub={s.topProduct ? <><Money cents={s.topProductCents} /> over {s.topProductCount}</> : "no product refunds"} />
      </div>

      {refunds.length === 0 && <p className="text-slate-500">No refunds in the imported ledger.</p>}

      {returns.length > 0 && (
        <RefundsCard refunds={returns} totalCents={s.productCents + s.shippingCents} title="Refunds" />
      )}

      {cancellations.length > 0 && (
        <RefundsCard refunds={cancellations} totalCents={s.cancelledCents} title="Cancellations" />
      )}

      {nonShows.length > 0 && (
        <Card title={<div className="flex justify-between"><span>Non-show activity ({nonShows.length})</span><span className="normal-case">Net: <Money cents={nonShowNetCents} /></span></div>}>
          <p className="text-sm text-slate-500">
            Refunds, fees, and claims landing on dates with no sales. Counted in your dashboard totals.
          </p>
          <ul className="mt-2 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            {nonShows.map((x) => (
              <li key={x.showId} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-slate-600">{x.showDate}</span>
                  <span className="truncate text-xs text-slate-400">{x.what}</span>
                </span>
                <span className="shrink-0"><Money cents={x.netCents} /></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
