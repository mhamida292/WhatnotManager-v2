import { describe, it, expect } from "vitest";
import { narrowReportToRange } from "@/lib/calc/report-range";
import type { LedgerReport, ReportShow } from "@/lib/calc/ledger-report";

const show = (showDate: string, over: Partial<ReportShow> = {}): ReportShow => ({
  showId: Number(showDate.replace(/-/g, "").slice(4)), showDate, sessionSeq: 0,
  timeRange: "", dateHasMultipleSessions: false, products: [],
  giveawayTotalCents: 0, giveawayCount: 0, giveawayCostCents: 0, giveawayUnallocated: false,
  tipTotalCents: 0, bonusTotalCents: 0, otherTotalCents: 0,
  payoutCents: 1000, withdrawnToBankCents: 0, payoutFailureCents: 0,
  cogsCents: 400, shippingSuppliesCents: 0, laborCents: 100,
  netCents: 500, unitsSold: 10, saleCount: 5, ...over,
});

const report = (shows: ReportShow[], over: Partial<LedgerReport> = {}): LedgerReport => ({
  shows,
  giveawayUnitCents: 500,
  totals: {
    revenueCents: 0, cogsCents: 0, giveawayCostCents: 0, shippingSuppliesCents: 0,
    laborCents: 0, unallocatedLaborCents: 0, netCents: 0, withdrawnToBankCents: -9999,
    payoutFailureCents: 0, unitsSold: 0,
  },
  wholesale: { invoices: [], paidRevenueCents: 0, paidCogsCents: 0, paidProfitCents: 0, owedToYouCents: 0 },
  unmappedNames: [], unmappedCount: 0, unrecognizedPayoutMessages: [],
  ...over,
});

const july = { from: "2026-07-01", to: "2026-07-31" };

describe("narrowReportToRange", () => {
  it("returns the report untouched when there is no range", () => {
    const r = report([show("2026-06-10"), show("2026-07-10")]);
    expect(narrowReportToRange(r, undefined)).toBe(r);
    expect(narrowReportToRange(r, {})).toBe(r);
  });

  it("keeps only shows inside the range", () => {
    const r = report([show("2026-06-30"), show("2026-07-01"), show("2026-07-31"), show("2026-08-01")]);
    expect(narrowReportToRange(r, july).shows.map((s) => s.showDate))
      .toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("re-totals from the shows it kept", () => {
    const r = report([
      show("2026-07-05", { cogsCents: 400, giveawayCostCents: 50, laborCents: 100, netCents: 450, unitsSold: 10 }),
      show("2026-07-06", { cogsCents: 600, giveawayCostCents: 25, laborCents: 0, netCents: 375, unitsSold: 5 }),
      show("2026-08-01", { cogsCents: 999, netCents: 999, unitsSold: 99 }),
    ]);
    const t = narrowReportToRange(r, july).totals;
    expect(t.cogsCents).toBe(1000);
    expect(t.giveawayCostCents).toBe(75);
    expect(t.laborCents).toBe(100);
    expect(t.netCents).toBe(825);
    expect(t.unitsSold).toBe(15);
  });

  it("leaves withdrawnToBankCents alone — a balance has no period", () => {
    const r = report([show("2026-08-01")]);
    expect(narrowReportToRange(r, july).totals.withdrawnToBankCents).toBe(-9999);
  });

  it("yields zeroes, not NaN, for a month with no shows", () => {
    const t = narrowReportToRange(report([show("2026-08-01")]), july).totals;
    expect(t.netCents).toBe(0);
    expect(t.unitsSold).toBe(0);
    expect(Number.isNaN(t.cogsCents)).toBe(false);
  });

  it("filters wholesale on the invoice date, not the show dates", () => {
    const r = report([show("2026-07-05")], {
      wholesale: {
        invoices: [
          { invoiceId: 1, number: "INV-0001", invoiceDate: "2026-07-04", customer: null, paid: true, qty: 3, revenueCents: 3400, cogsCents: 3260, profitCents: 140 },
          { invoiceId: 2, number: "INV-0002", invoiceDate: "2026-08-04", customer: null, paid: true, qty: 1, revenueCents: 1000, cogsCents: 600, profitCents: 400 },
        ],
        paidRevenueCents: 4400, paidCogsCents: 3860, paidProfitCents: 540, owedToYouCents: 0,
      },
    });
    const n = narrowReportToRange(r, july);
    const w = n.wholesale;
    expect(w.invoices.map((i) => i.number)).toEqual(["INV-0001"]);
    expect(w.paidRevenueCents).toBe(3400);
    expect(w.paidProfitCents).toBe(140);
    // totals.unitsSold must fold in paid-wholesale qty, same as buildLedgerReport does --
    // the show contributes 10 (its default unitsSold) and the in-range paid invoice contributes 3.
    expect(n.totals.unitsSold).toBe(13);
  });

  it("recomputes revenue and unmapped names from the kept shows", () => {
    const line = (name: string, mapped: boolean, rev: number) =>
      ({ productName: name, itemId: mapped ? 1 : null, mapped, unitCostCents: null, qty: 1, costCents: 0, revenueCents: rev, profitCents: rev });
    const r = report([
      show("2026-07-05", { products: [line("Kept", false, 700)] }),
      show("2026-08-05", { products: [line("Dropped", false, 900)] }),
    ], { unmappedNames: ["Dropped", "Kept"], unmappedCount: 2 });
    const n = narrowReportToRange(r, july);
    expect(n.totals.revenueCents).toBe(700);
    expect(n.unmappedNames).toEqual(["Kept"]);
    expect(n.unmappedCount).toBe(1);
  });

  it("does not resurrect a dismissed name that buildLedgerReport already excluded", () => {
    const line = (name: string, mapped: boolean, rev: number) =>
      ({ productName: name, itemId: mapped ? 1 : null, mapped, unitCostCents: null, qty: 1, costCents: 0, revenueCents: rev, profitCents: rev });
    // "Dismissed Thing" has mapped: false on its product line, exactly like a
    // real unmapped name -- but buildLedgerReport already decided to exclude
    // it from unmappedNames (the user dismissed it), so it must not reappear
    // just because narrowing re-derives the set from product lines.
    const r = report([
      show("2026-07-05", { products: [line("Kept", false, 700), line("Dismissed Thing", false, 300)] }),
    ], { unmappedNames: ["Kept"], unmappedCount: 1 });
    const n = narrowReportToRange(r, july);
    expect(n.unmappedNames).toEqual(["Kept"]);
    expect(n.unmappedNames).not.toContain("Dismissed Thing");
  });

  it("a range covering the entire timeline produces totals and unmappedNames equal to the unfiltered report", () => {
    const line = (name: string, mapped: boolean, rev: number) =>
      ({ productName: name, itemId: mapped ? 1 : null, mapped, unitCostCents: null, qty: 1, costCents: 0, revenueCents: rev, profitCents: rev });
    const r = report([
      show("2026-06-10", { products: [line("Kept", false, 700)] }),
      show("2026-07-10", { products: [line("Dismissed Thing", false, 300)] }),
    ], { unmappedNames: ["Kept"], unmappedCount: 1 });
    const wholeRange = { from: "2026-01-01", to: "2026-12-31" };
    const n = narrowReportToRange(r, wholeRange);
    expect(n.unmappedNames).toEqual(r.unmappedNames);
    expect(n.unmappedNames).not.toContain("Dismissed Thing");
    expect(n.totals.revenueCents).toBe(1000);
  });
});
