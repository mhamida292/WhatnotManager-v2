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

  // A dismissed name still has mapped: false on its product line -- only
  // buildLedgerReport knows it was dismissed (it never made it into
  // report.unmappedNames in the first place). Re-deriving from product lines
  // alone would resurrect it, so intersect with what the unnarrowed report
  // already decided is unmapped.
  const original = new Set(report.unmappedNames);
  const unmapped = new Set<string>();
  for (const s of shows) {
    for (const p of s.products) if (!p.mapped && !p.isBundle && original.has(p.productName)) unmapped.add(p.productName);
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
      unitsSold: sum((s) => s.unitsSold) + paid.reduce((a, i) => a + i.qty, 0),
      // withdrawnToBankCents and unallocatedLaborCents are intentionally carried
      // through unchanged -- see the doc comment above.
    },
    unmappedNames: [...unmapped].sort(),
    unmappedCount: unmapped.size,
  };
}
