import { describe, it, expect } from "vitest";
import { breakdownRows } from "@/components/dashboard/Breakdown";

describe("breakdownRows", () => {
  const input = {
    payoutCents: 100000, cogsCents: 47000, giveawayCostCents: 2300,
    laborCents: 500, expensesCents: 2200, showProfitCents: 50200,
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
});
