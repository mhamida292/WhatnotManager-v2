import { describe, it, expect } from "vitest";
import { showPnl, splitProfit } from "@/lib/calc/show-pnl";

describe("showPnl", () => {
  it("net = payout - cogs - giveaways - shipping; split 80/20", () => {
    const r = showPnl({
      payoutCents: 20000,
      cogsCents: 5000,
      giveawayCount: 6,
      giveawayUnitCents: 500,
      shippingSuppliesCents: 1000,
    });
    expect(r.giveawayTotalCents).toBe(3000);
    expect(r.netProfitCents).toBe(20000 - 5000 - 3000 - 1000); // 11000
    expect(r.ownerShareCents).toBe(8800);   // 80%
    expect(r.partnerShareCents).toBe(2200);  // 20%
  });
  it("rounds split to whole cents with owner absorbing the remainder", () => {
    const r = showPnl({ payoutCents: 101, cogsCents: 0, giveawayCount: 0, giveawayUnitCents: 0, shippingSuppliesCents: 0 });
    expect(r.partnerShareCents).toBe(20);    // floor(101*0.2)=20
    expect(r.ownerShareCents).toBe(81);      // remainder to owner
    expect(r.ownerShareCents + r.partnerShareCents).toBe(101);
  });
  it("net can be negative", () => {
    const r = showPnl({ payoutCents: 1000, cogsCents: 2000, giveawayCount: 0, giveawayUnitCents: 0, shippingSuppliesCents: 0 });
    expect(r.netProfitCents).toBe(-1000);
  });
});

describe("splitProfit", () => {
  it("defaults to 80/20 with owner absorbing the remainder", () => {
    expect(splitProfit(10000, 80)).toEqual({ ownerShareCents: 8000, partnerShareCents: 2000 });
  });
  it("respects a custom owner percentage", () => {
    expect(splitProfit(10000, 70)).toEqual({ ownerShareCents: 7000, partnerShareCents: 3000 });
  });
  it("owner absorbs the rounding remainder", () => {
    // partner = floor(101 * 0.2) = 20; owner = 81
    expect(splitProfit(101, 80)).toEqual({ ownerShareCents: 81, partnerShareCents: 20 });
  });
  it("uses floor for negative net so the partner share is the floored value (documented rule)", () => {
    // partner = floor(-101 * 0.2) = floor(-20.2) = -21; owner = -101 - (-21) = -80
    expect(splitProfit(-101, 80)).toEqual({ ownerShareCents: -80, partnerShareCents: -21 });
  });
});
