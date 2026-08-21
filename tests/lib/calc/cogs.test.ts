import { describe, it, expect } from "vitest";
import { lineCogs, totalCogs } from "@/lib/calc/cogs";

describe("cogs", () => {
  it("multiplies quantity by unit cost in cents", () => {
    expect(lineCogs(2, 250)).toBe(500);
  });
  it("sums confirmed line cogs, ignores unmapped (null) costs as zero", () => {
    const lines = [
      { quantity: 1, unitCostCents: 250 },
      { quantity: 3, unitCostCents: 150 },
      { quantity: 1, unitCostCents: null },
    ];
    expect(totalCogs(lines)).toBe(250 + 450 + 0);
  });
});
