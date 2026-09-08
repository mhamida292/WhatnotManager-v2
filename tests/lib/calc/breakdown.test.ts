import { describe, it, expect } from "vitest";
import { breakdownRows } from "@/components/dashboard/Breakdown";

describe("breakdownRows", () => {
  const input = {
    payoutCents: 100000, wholesaleRevenueCents: 0, cogsCents: 47000, giveawayCostCents: 2300,
    shippingSuppliesCents: 0, laborCents: 500, expensesCents: 2200, showProfitCents: 50200,
    businessProfitCents: 48000,
  };

  it("scales every bar against the payout", () => {
    const rows = breakdownRows(input);
    expect(rows.find((r) => r.label === "Payout")!.widthPct).toBe(100);
    expect(rows.find((r) => r.label === "COGS")!.widthPct).toBe(47);
    expect(rows.find((r) => r.label === "Business profit")!.widthPct).toBe(48);
  });

  it("keeps deduction amounts negative for display", () => {
    const rows = breakdownRows(input);
    expect(rows.find((r) => r.label === "COGS")!.amountCents).toBe(-47000);
    expect(rows.find((r) => r.label === "Payout")!.amountCents).toBe(100000);
  });

  it("does not divide by zero when a period has no payout", () => {
    const rows = breakdownRows({ ...input, payoutCents: 0 });
    for (const r of rows) expect(Number.isNaN(r.widthPct)).toBe(false);
    expect(rows.every((r) => r.widthPct >= 0)).toBe(true);
  });

  it("clamps a negative profit to a zero-width bar rather than a backwards one", () => {
    const rows = breakdownRows({ ...input, businessProfitCents: -500 });
    expect(rows.find((r) => r.label === "Business profit")!.widthPct).toBe(0);
  });

  it("omits Wholesale and Shipping when both are zero", () => {
    const rows = breakdownRows(input);
    expect(rows.find((r) => r.label === "Wholesale")).toBeUndefined();
    expect(rows.find((r) => r.label === "Shipping")).toBeUndefined();
  });

  it("reconciles: Payout + Wholesale - COGS - Giveaways - Shipping - Labor = Show profit, and Show profit - Expenses = Business profit", () => {
    const full = {
      payoutCents: 100000, wholesaleRevenueCents: 15000, cogsCents: 47000, giveawayCostCents: 2300,
      shippingSuppliesCents: 1800, laborCents: 500, expensesCents: 2200,
      // showProfit = 100000 + 15000 - 47000 - 2300 - 1800 - 500 = 63400
      showProfitCents: 63400,
      // businessProfit = 63400 - 2200 = 61200
      businessProfitCents: 61200,
    };
    const rows = breakdownRows(full);
    const amount = (label: string) => rows.find((r) => r.label === label)!.amountCents;

    expect(rows.find((r) => r.label === "Wholesale")).toBeDefined();
    expect(rows.find((r) => r.label === "Shipping")).toBeDefined();

    const recomputedShowProfit =
      amount("Payout") + amount("Wholesale") + amount("COGS") + amount("Giveaways") +
      amount("Shipping") + amount("Labor");
    expect(recomputedShowProfit).toBe(amount("Show profit"));

    const recomputedBusinessProfit = amount("Show profit") + amount("Expenses");
    expect(recomputedBusinessProfit).toBe(amount("Business profit"));
  });
});
