import { dbForRequest } from "@/lib/auth/request";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { getSettings } from "@/lib/db/settings";
import { splitProfit } from "@/lib/calc/show-pnl";
import { showDeleteImpact } from "@/lib/db/shows";
import { Money } from "@/components/Money";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProductsTable } from "@/components/ProductsTable";
import { DeleteShowButton } from "@/components/DeleteShowButton";
import GiveawayAllocationEditor from "@/components/GiveawayAllocationEditor";
import BundleEditor from "@/components/BundleEditor";
import { showSessionLabel } from "@/lib/ui/show-label";

export const dynamic = "force-dynamic";

export default async function ShowDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await dbForRequest();
  const rep = buildLedgerReport(db);
  const show = rep.shows.find((s) => s.showId === Number(id));
  if (!show) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Show not found</h1>
        <p className="text-slate-500">It may have been removed by a reset. See the Report page.</p>
      </div>
    );
  }
  const impact = showDeleteImpact(db, show.showId);
  const { ownerSharePct } = getSettings(db);
  const split = splitProfit(show.netCents, ownerSharePct);
  const giveawayLabel = `Giveaways (${show.giveawayCount})`;
  const rows: [string, React.ReactNode][] = [
    ["Payout", <Money cents={show.payoutCents} />],
    ["Units sold", show.unitsSold],
    ["COGS (items sold)", <Money cents={-show.cogsCents} />],
    [giveawayLabel, <Money cents={-show.giveawayCostCents} />],
    ["Shipping supplies", <Money cents={-show.shippingSuppliesCents} />],
    ["Net profit", <Money cents={show.netCents} />],
    [`Your ${ownerSharePct}%`, <Money cents={split.ownerShareCents} />],
    [`Partner ${100 - ownerSharePct}%`, <Money cents={split.partnerShareCents} />],
  ];
  return (
    <div className="space-y-6">
      <PageHeader title={`Show — ${showSessionLabel(show)}`} subtitle="Profit and loss for this show" />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card title="Summary">
          <table className="w-full text-sm">
            <tbody>{rows.map(([k, v], i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-2 pr-8 text-slate-500">{k}</td>
                <td className="py-2 text-right">{v}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>

        {show.products.length > 0 && <ProductsTable products={show.products} variant="show" />}
      </div>
      {show.payoutFailureCents > 0 && (
        <p className="text-sm text-amber-700">
          ⚠ A payout of <Money cents={show.payoutFailureCents} /> failed and was returned to your Whatnot
          balance on this date. It is not counted as profit here, and it never reached your bank.
        </p>
      )}
      <Card title="Giveaway Allocations">
        <GiveawayAllocationEditor showId={show.showId} detectedCount={show.giveawayCount} />
        {show.giveawayUnallocated && (
          <p className="mt-3 text-sm text-amber-700">⚠ Giveaways not entered yet — counted as $0.</p>
        )}
      </Card>
      {!rep.pool && (
        <Card title="Bundles">
          <p className="mb-3 text-sm text-slate-600">
            Combined an on-screen bundle from several items? Pick its sale line and list what went into it — profit = revenue − component cost.
          </p>
          <BundleEditor showId={show.showId} />
        </Card>
      )}
      <div className="border-t border-line pt-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Danger zone</p>
        <DeleteShowButton id={show.showId} showDate={show.showDate} impact={impact} />
      </div>
    </div>
  );
}
