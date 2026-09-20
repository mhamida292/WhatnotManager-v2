import { describe, it, expect } from "vitest";
import { summariseRefunds } from "@/lib/calc/refund-summary";
import type { RefundRow } from "@/lib/db/ledger-refunds";

const row = (over: Partial<RefundRow>): RefundRow => ({
  showDate: "2026-08-11", amountCents: -500, orderId: "o1",
  productName: "Cheese Squishy", itemId: 1, isShipping: false, isCancellation: false, ...over,
});

describe("summariseRefunds", () => {
  it("splits product refunds from return shipping", () => {
    const s = summariseRefunds([
      row({ amountCents: -800 }),
      row({ amountCents: -200, isShipping: true, productName: null }),
      row({ amountCents: -300 }),
    ]);
    expect(s.productCents).toBe(-1100);
    expect(s.productCount).toBe(2);
    expect(s.shippingCents).toBe(-200);
    expect(s.shippingCount).toBe(1);
  });

  it("names the product refunded for the most money", () => {
    const s = summariseRefunds([
      row({ productName: "Small", amountCents: -100 }),
      row({ productName: "Big", amountCents: -900 }),
      row({ productName: "Small", amountCents: -100 }),
    ]);
    expect(s.topProduct).toBe("Big");
    expect(s.topProductCents).toBe(-900);
    expect(s.topProductCount).toBe(1);
  });

  // Several small refunds should outrank one larger single refund.
  it("ranks by total refunded, not by a single largest refund", () => {
    const s = summariseRefunds([
      row({ productName: "Often", amountCents: -400 }),
      row({ productName: "Often", amountCents: -400 }),
      row({ productName: "Once", amountCents: -700 }),
    ]);
    expect(s.topProduct).toBe("Often");
    expect(s.topProductCents).toBe(-800);
    expect(s.topProductCount).toBe(2);
  });

  it("ignores shipping rows when picking the top product", () => {
    const s = summariseRefunds([
      row({ productName: null, isShipping: true, amountCents: -9999 }),
      row({ productName: "Cheese", amountCents: -100 }),
    ]);
    expect(s.topProduct).toBe("Cheese");
  });

  it("has no top product when every refund is shipping", () => {
    const s = summariseRefunds([row({ productName: null, isShipping: true, amountCents: -200 })]);
    expect(s.topProduct).toBeNull();
    expect(s.topProductCents).toBe(0);
    expect(s.topProductCount).toBe(0);
  });

  it("returns zeroes for no refunds at all", () => {
    const s = summariseRefunds([]);
    expect(s).toEqual({
      productCents: 0, productCount: 0, shippingCents: 0, shippingCount: 0,
      cancelledCents: 0, cancelledCount: 0,
      topProduct: null, topProductCents: 0, topProductCount: 0,
    });
  });

  it("counts cancellations apart from refunds", () => {
    const s = summariseRefunds([
      row({ amountCents: -800 }),
      row({ amountCents: -5392, isCancellation: true }),
      row({ amountCents: -200, isShipping: true, productName: null }),
    ]);
    expect(s.cancelledCents).toBe(-5392);
    expect(s.cancelledCount).toBe(1);
    expect(s.productCents).toBe(-800);   // cancellation excluded
    expect(s.productCount).toBe(1);
  });

  // A cancelled order is not a returned product; it must not win "most refunded".
  it("ignores cancellations when picking the top refunded product", () => {
    const s = summariseRefunds([
      row({ productName: "Cancelled Big", amountCents: -5392, isCancellation: true }),
      row({ productName: "Truly Refunded", amountCents: -300 }),
    ]);
    expect(s.topProduct).toBe("Truly Refunded");
  });

  // An unmapped refund still has a name worth grouping on.
  it("groups an unmapped product by name", () => {
    const s = summariseRefunds([row({ productName: "Mystery", itemId: null, amountCents: -250 })]);
    expect(s.topProduct).toBe("Mystery");
    expect(s.topProductCents).toBe(-250);
  });
});
