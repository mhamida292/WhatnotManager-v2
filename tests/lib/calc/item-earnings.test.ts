import { describe, it, expect } from "vitest";
import { itemEarnings } from "@/lib/calc/item-earnings";

describe("itemEarnings", () => {
  it("revenue sums amounts, cost = count × unit cost, profit = revenue − cost", () => {
    const out = itemEarnings([{ amountCents: 100 }, { amountCents: 150 }, { amountCents: 200 }], 50);
    expect(out).toEqual({ revenueCents: 450, costCents: 150, profitCents: 300 });
  });

  it("returns all zeros when there are no sales", () => {
    expect(itemEarnings([], 50)).toEqual({ revenueCents: 0, costCents: 0, profitCents: 0 });
  });

  it("reports negative profit when cost exceeds revenue", () => {
    const out = itemEarnings([{ amountCents: 10 }, { amountCents: 20 }], 100);
    expect(out).toEqual({ revenueCents: 30, costCents: 200, profitCents: -170 });
  });
});
