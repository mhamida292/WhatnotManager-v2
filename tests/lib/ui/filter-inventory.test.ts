import { describe, it, expect } from "vitest";
import { filterInventory } from "@/lib/ui/filter-inventory";

const items = [
  { name: "Cheese Squishy", remaining: 10 },
  { name: "Mango Slime", remaining: 2 },
  { name: "Dino Squishy", remaining: 0 },
];

describe("filterInventory", () => {
  it("name search is case-insensitive substring and trims", () => {
    expect(filterInventory(items, { search: "  squISHY ", status: "all" }).map((i) => i.name))
      .toEqual(["Cheese Squishy", "Dino Squishy"]);
  });

  it("empty search returns all", () => {
    expect(filterInventory(items, { search: "", status: "all" })).toHaveLength(3);
  });

  it("status buckets match stock thresholds", () => {
    expect(filterInventory(items, { search: "", status: "out" }).map((i) => i.name)).toEqual(["Dino Squishy"]);
    expect(filterInventory(items, { search: "", status: "low" }).map((i) => i.name)).toEqual(["Mango Slime"]);
    expect(filterInventory(items, { search: "", status: "in" }).map((i) => i.name)).toEqual(["Cheese Squishy"]);
  });

  it("search and status combine with AND", () => {
    expect(filterInventory(items, { search: "squishy", status: "out" }).map((i) => i.name)).toEqual(["Dino Squishy"]);
  });

  it("does not mutate the input", () => {
    const copy = [...items];
    filterInventory(items, { search: "x", status: "out" });
    expect(items).toEqual(copy);
  });
});
