import { describe, it, expect } from "vitest";
import { netInventorySpend } from "@/lib/calc/inventory-spend";

describe("netInventorySpend", () => {
  it("sums item costs", () => {
    expect(netInventorySpend({ itemCostsCents: [1000, 250, 5] })).toBe(1255);
  });

  it("is zero for no items", () => {
    expect(netInventorySpend({ itemCostsCents: [] })).toBe(0);
  });
});
