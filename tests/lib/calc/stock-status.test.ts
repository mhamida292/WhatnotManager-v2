import { describe, it, expect } from "vitest";
import { stockBadge, LOW_STOCK_THRESHOLD } from "@/lib/calc/stock-status";

describe("stockBadge", () => {
  it("flags out of stock at zero or below", () => {
    expect(stockBadge(0)?.label).toBe("Out of stock");
    expect(stockBadge(-2)?.label).toBe("Out of stock");
  });
  it("flags low stock from 1 up to the threshold", () => {
    expect(stockBadge(1)?.label).toBe("Low");
    expect(stockBadge(LOW_STOCK_THRESHOLD)?.label).toBe("Low");
  });
  it("returns null when comfortably in stock", () => {
    expect(stockBadge(LOW_STOCK_THRESHOLD + 1)).toBeNull();
    expect(stockBadge(50)).toBeNull();
  });
});
