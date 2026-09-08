import { describe, it, expect } from "vitest";
import { uncostedSales } from "@/lib/calc/uncosted-sales";
import type { LedgerReport, ReportShow, ReportProductLine } from "@/lib/calc/ledger-report";

const line = (over: Partial<ReportProductLine>): ReportProductLine => ({
  productName: "X", itemId: null, mapped: false, unitCostCents: null,
  qty: 1, costCents: 0, revenueCents: 100, profitCents: 100, ...over,
});

const rep = (products: ReportProductLine[]): LedgerReport => ({
  shows: [{
    showId: 1, showDate: "2026-07-01", sessionSeq: 0, timeRange: "", dateHasMultipleSessions: false,
    products, giveawayTotalCents: 0, giveawayCount: 0, giveawayCostCents: 0, giveawayUnallocated: false,
    tipTotalCents: 0, bonusTotalCents: 0, otherTotalCents: 0, payoutCents: 0, withdrawnToBankCents: 0,
    payoutFailureCents: 0, cogsCents: 0, shippingSuppliesCents: 0, laborCents: 0, netCents: 0,
    unitsSold: 0, saleCount: 0,
  } as ReportShow],
  giveawayUnitCents: 500,
  totals: { revenueCents: 0, cogsCents: 0, giveawayCostCents: 0, shippingSuppliesCents: 0, laborCents: 0,
    unallocatedLaborCents: 0, netCents: 0, withdrawnToBankCents: 0, payoutFailureCents: 0, unitsSold: 0 },
  wholesale: { invoices: [], paidRevenueCents: 0, paidCogsCents: 0, paidProfitCents: 0, owedToYouCents: 0 },
  unmappedNames: [], unmappedCount: 0, unrecognizedPayoutMessages: [],
});

describe("uncostedSales", () => {
  it("counts sales with no cost attached", () => {
    const r = uncostedSales(rep([
      line({ productName: "Bundle A", qty: 2, revenueCents: 500 }),
      line({ productName: "Mapped", mapped: true, itemId: 1, costCents: 150 }),
    ]));
    expect(r.count).toBe(2);              // qty, not lines
    expect(r.revenueCents).toBe(500);
  });

  it("ignores a bundle that has components — it is already costed", () => {
    const r = uncostedSales(rep([
      line({ productName: "Bundle B", isBundle: true, mapped: true, costCents: 800, revenueCents: 1600 }),
    ]));
    expect(r.count).toBe(0);
    expect(r.estimatedCostCents).toBe(0);
  });

  it("estimates missing cost from the average of costed bundles", () => {
    const r = uncostedSales(rep([
      line({ productName: "Costed 1", isBundle: true, mapped: true, costCents: 600, qty: 1 }),
      line({ productName: "Costed 2", isBundle: true, mapped: true, costCents: 1000, qty: 1 }),
      line({ productName: "Uncosted", qty: 3 }),
    ]));
    // average costed bundle = (600 + 1000) / 2 = 800; 3 uncosted -> 2400
    expect(r.estimatedCostCents).toBe(2400);
  });

  it("estimates zero when there is no costed bundle to learn from", () => {
    expect(uncostedSales(rep([line({ qty: 5 })])).estimatedCostCents).toBe(0);
  });

  it("returns zeroes for a report with nothing uncosted", () => {
    expect(uncostedSales(rep([]))).toEqual({ count: 0, revenueCents: 0, estimatedCostCents: 0 });
  });
});
