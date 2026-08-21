import { describe, it, expect } from "vitest";
import { inStockSummary } from "@/lib/calc/in-stock";

describe("inStockSummary", () => {
  it("sums units and value across items", () => {
    const out = inStockSummary([
      { remaining: 3, unitCostCents: 200 },
      { remaining: 2, unitCostCents: 150 },
    ]);
    expect(out).toEqual({ units: 5, valueCents: 900, productsInStock: 2, totalProducts: 2 });
  });

  it("clamps a negative-remaining item to 0 for units and value, but counts it in totalProducts", () => {
    const out = inStockSummary([
      { remaining: 4, unitCostCents: 100 },   // 4 units, 400c
      { remaining: -11, unitCostCents: 225 }, // oversold -> 0 units, 0c
    ]);
    expect(out).toEqual({ units: 4, valueCents: 400, productsInStock: 1, totalProducts: 2 });
  });

  it("does not count a zero-remaining item as in stock", () => {
    const out = inStockSummary([
      { remaining: 0, unitCostCents: 100 },
      { remaining: 5, unitCostCents: 100 },
    ]);
    expect(out).toEqual({ units: 5, valueCents: 500, productsInStock: 1, totalProducts: 2 });
  });

  it("returns all zeros for an empty list", () => {
    expect(inStockSummary([])).toEqual({ units: 0, valueCents: 0, productsInStock: 0, totalProducts: 0 });
  });
});
