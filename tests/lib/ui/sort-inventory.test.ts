import { describe, it, expect } from "vitest";
import { sortInventory, type SortableItem } from "@/lib/ui/sort-inventory";

const mk = (name: string, remaining: number, unitCostCents = 0): SortableItem => ({
  name, remaining, unitCostCents, qtyPurchased: 0, sold: 0, warehouse: 0, whatnot: 0,
});

describe("sortInventory", () => {
  it("sorts by name case-insensitively ascending", () => {
    const out = sortInventory([mk("banana", 1), mk("Apple", 2)], "name", "asc");
    expect(out.map((i) => i.name)).toEqual(["Apple", "banana"]);
  });

  it("sorts numbers ascending and descending", () => {
    const items = [mk("a", 5), mk("b", 1), mk("c", 3)];
    expect(sortInventory(items, "remaining", "asc").map((i) => i.remaining)).toEqual([1, 3, 5]);
    expect(sortInventory(items, "remaining", "desc").map((i) => i.remaining)).toEqual([5, 3, 1]);
  });

  it("does not mutate the input array", () => {
    const items = [mk("b", 2), mk("a", 1)];
    const copy = [...items];
    sortInventory(items, "name", "asc");
    expect(items).toEqual(copy);
  });
});
