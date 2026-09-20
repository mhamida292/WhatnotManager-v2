import { describe, it, expect } from "vitest";
import { describeActivity } from "@/lib/calc/activity-label";

const row = (kind: string, message = "") => ({ kind, message });

describe("describeActivity", () => {
  it("names a single refund", () => {
    expect(describeActivity([row("refund", "Reversal of sales transaction for order refund")]))
      .toBe("Refund");
  });

  it("counts repeats and pluralises", () => {
    expect(describeActivity([
      row("refund", "Reversal of sales transaction for order refund"),
      row("refund", "Reversal of sales transaction for order refund"),
    ])).toBe("2 refunds");
  });

  // Return shipping is its own thing, not another refund.
  it("separates return shipping from the refund itself", () => {
    expect(describeActivity([
      row("refund", "Reversal of sales transaction for order refund"),
      row("refund", "Deduction for order refund shipping costs [Order Id: 1]"),
    ])).toBe("Refund · return shipping");
  });

  it("names a bank payout", () => {
    expect(describeActivity([row("payout", "Payout request: STRIPE acct_1")]))
      .toBe("Bank payout");
  });

  it("joins several kinds, most numerous first", () => {
    expect(describeActivity([
      row("payout", "Payout request: STRIPE acct_1"),
      row("other", "Approved Insurance Claim for shipment 383621725"),
      row("payout", "Payout request: STRIPE acct_1"),
    ])).toBe("2 bank payouts · insurance claim");
  });

  it("recognises the kinds of adjustment that show up in 'other'", () => {
    expect(describeActivity([row("other", "Seller purchased Show Boost for \"X\"")])).toBe("Promotion");
    expect(describeActivity([row("other", "Whatnot platform charge for shipping adjustment on Shipment 1")]))
      .toBe("Shipping adjustment");
    expect(describeActivity([row("other", "Fee for order cancellation")])).toBe("Cancellation fee");
  });

  it("falls back to a neutral word for an unrecognised adjustment", () => {
    expect(describeActivity([row("other", "Something entirely new from Whatnot")])).toBe("Adjustment");
  });

  it("names tips, bonuses and giveaway fees", () => {
    expect(describeActivity([row("tip", "Tip from a viewer")])).toBe("Tip");
    expect(describeActivity([row("bonus", "New Seller Sales Match Bonus")])).toBe("Bonus");
    expect(describeActivity([row("giveaway", "Charged deduction of $0.78 for giveaway order x")]))
      .toBe("Giveaway fee");
  });

  it("says nothing for no rows at all", () => {
    expect(describeActivity([])).toBe("");
  });
});
