import { describe, it, expect } from "vitest";
import { sortProducts, type SortableProduct } from "@/lib/calc/sort-products";

const rows: SortableProduct[] = [
  { productName: "Banana", qty: 1, unitCostCents: 300, costCents: 300, revenueCents: 900, profitCents: 600 },
  { productName: "Apple",  qty: 5, unitCostCents: null, costCents: 0,   revenueCents: 250, profitCents: 250 },
  { productName: "Cherry", qty: 2, unitCostCents: 100, costCents: 200, revenueCents: 200, profitCents: 0 },
];
const names = (r: SortableProduct[]) => r.map((p) => p.productName);

describe("sortProducts", () => {
  it("sorts by name ascending and descending", () => {
    expect(names(sortProducts(rows, "productName", "asc"))).toEqual(["Apple", "Banana", "Cherry"]);
    expect(names(sortProducts(rows, "productName", "desc"))).toEqual(["Cherry", "Banana", "Apple"]);
  });

  it("sorts by a numeric metric", () => {
    expect(names(sortProducts(rows, "qty", "asc"))).toEqual(["Banana", "Cherry", "Apple"]);
    expect(names(sortProducts(rows, "revenueCents", "desc"))).toEqual(["Banana", "Apple", "Cherry"]);
  });

  it("puts null unit cost last regardless of direction", () => {
    expect(names(sortProducts(rows, "unitCostCents", "asc")).at(-1)).toBe("Apple");
    expect(names(sortProducts(rows, "unitCostCents", "desc")).at(-1)).toBe("Apple");
  });

  it("sorts by avg-per-unit (revenue/qty), null qty<=0 last", () => {
    // Banana 900/1=900, Cherry 200/2=100, Apple 250/5=50
    expect(names(sortProducts(rows, "avgPerUnit", "desc"))).toEqual(["Banana", "Cherry", "Apple"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortProducts(rows, "qty", "desc");
    expect(rows).toEqual(copy);
  });
});
