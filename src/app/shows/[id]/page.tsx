import { dbForRequest } from "@/lib/auth/request";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { getSettings } from "@/lib/db/settings";
import { showDeleteImpact } from "@/lib/db/shows";
import { Money } from "@/components/Money";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProductsTable } from "@/components/ProductsTable";
import { DeleteShowButton } from "@/components/DeleteShowButton";
import GiveawayAllocationEditor from "@/components/GiveawayAllocationEditor";
import BundleEditor from "@/components/BundleEditor";
import { showSessionLabel } from "@/lib/ui/show-label";
import { avgPerUnitCents } from "@/lib/calc/avg-per-unit";
import { formatMinutes } from "@/lib/calc/selling-window";

export const dynamic = "force-dynamic";

type SummaryRow = { label: string; value: React.ReactNode; total?: boolean; note?: string };

/** One labelled block of the summary card. The heading is what separates the
 *  blocks, so the rows themselves need no extra spacing. */
function SummarySection({ label, rows }: { label: string; rows: SummaryRow[] }) {
  return (
    <>
      <p className="mb-1 border-b border-slate-300 pb-1.5 pt-9 text-xs font-bold uppercase tracking-widest text-slate-600 first:pt-0">{label}</p>
      <table className="w-full text-sm">
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-b border-line last:border-b-0">
            <td className={`py-2 pr-8 ${r.total ? "font-medium text-slate-700" : "text-slate-500"}`}>
              {r.label}
              {r.note && <span className="ml-2 text-xs text-slate-400">{r.note}</span>}
            </td>
            <td className={`py-2 text-right${r.total ? " font-semibold" : ""}`}>{r.value}</td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}

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
  const avgSaleCents = avgPerUnitCents(show.revenueCents, show.unitsSold);
  // Whatnot's per-giveaway fee (ledger) and the stock given away (allocations)
  // are different money, so they sit as separate cost lines -- adjacent, since
  // they answer the same question together.
  const giveawayFeeCents = show.giveawayTotalCents;
  // Whatever payout holds beyond sales and that fee: tips, bonuses, refunds,
  // adjustments. A residual rather than tip+bonus, so the card reconciles on
  // every show, including ones carrying a refund.
  const nonSaleCents = show.payoutCents - show.revenueCents - giveawayFeeCents;
  // Folding the giveaway fee in with the other costs is what lets the card read
  // as one subtraction: revenue + tips - total costs = net profit.
  const totalCostCents = -giveawayFeeCents + show.giveawayCostCents + show.cogsCents
    + show.shippingSuppliesCents + show.laborCents;
  const salesRows: SummaryRow[] = [
    { label: "Revenue (sales)", value: <Money cents={show.revenueCents} /> },
    ...(nonSaleCents === 0 ? [] : [
      { label: "Tips & bonuses", value: <Money cents={nonSaleCents} /> },
    ]),
    ...(giveawayFeeCents === 0 ? [] : [
      { label: "Giveaway shipping fees", value: <Money cents={giveawayFeeCents} /> },
    ]),
    ...(show.giveawayCount === 0 ? [] : [
      { label: "Giveaway stock", value: <Money cents={-show.giveawayCostCents} />, note: `${show.giveawayCount} given` },
    ]),
    { label: "COGS (items sold)", value: <Money cents={-show.cogsCents} /> },
    { label: "Shipping supplies", value: <Money cents={-show.shippingSuppliesCents} /> },
    { label: "Labor", value: <Money cents={-show.laborCents} /> },
    { label: "Total costs", value: <Money cents={-totalCostCents} />, total: true },
    { label: "Payout", value: <Money cents={show.payoutCents} />, total: true },
    { label: "Net profit", value: <Money cents={show.netCents} />, total: true },
  ];
  const volumeRows: SummaryRow[] = [
    { label: "Units sold", value: show.unitsSold },
    ...(avgSaleCents == null ? [] : [
      { label: "Avg/unit", value: <Money cents={avgSaleCents} /> },
    ]),
    ...(show.sellingMinutes == null ? [] : [
      { label: "Selling time", value: formatMinutes(show.sellingMinutes) },
    ]),
    ...(show.unitsPerHour == null ? [] : [
      { label: "Units / hour", value: show.unitsPerHour },
    ]),
  ];
  return (
    <div className="space-y-6">
      <PageHeader title={`Show — ${showSessionLabel(show)}`} subtitle="Profit and loss for this show" />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card title="Summary">
          <SummarySection label="Sales" rows={salesRows} />
          <SummarySection label="Volume" rows={volumeRows} />
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
