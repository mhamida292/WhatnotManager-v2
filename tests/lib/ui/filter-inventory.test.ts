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

  it("hides archived items unless asked for them", () => {
    const mixed = [
      { name: "Live Squishy", remaining: 5, archivedAt: null },
      { name: "Old Squishy", remaining: 0, archivedAt: "2026-08-01" },
    ];
    expect(filterInventory(mixed, { search: "", status: "all" }).map((i) => i.name))
      .toEqual(["Live Squishy"]);
    expect(filterInventory(mixed, { search: "", status: "all", archive: "active" }).map((i) => i.name))
      .toEqual(["Live Squishy"]);
    expect(filterInventory(mixed, { search: "", status: "all", archive: "archived" }).map((i) => i.name))
      .toEqual(["Old Squishy"]);
    expect(filterInventory(mixed, { search: "", status: "all", archive: "all" }).map((i) => i.name))
      .toEqual(["Live Squishy", "Old Squishy"]);
  });

  it("searches across archived items when they are included", () => {
    const mixed = [
      { name: "Cheese Squishy", remaining: 5, archivedAt: null },
      { name: "Cheese Slime", remaining: 0, archivedAt: "2026-08-01" },
    ];
    expect(filterInventory(mixed, { search: "cheese", status: "all", archive: "all" }).map((i) => i.name))
      .toEqual(["Cheese Squishy", "Cheese Slime"]);
  });

  // An archived item is usually out of stock; the two filters must not fight.
  it("combines the archive filter with a stock bucket", () => {
    const mixed = [
      { name: "Live Out", remaining: 0, archivedAt: null },
      { name: "Archived Out", remaining: 0, archivedAt: "2026-08-01" },
      { name: "Archived Stocked", remaining: 9, archivedAt: "2026-08-02" },
    ];
    expect(filterInventory(mixed, { search: "", status: "out", archive: "all" }).map((i) => i.name))
      .toEqual(["Live Out", "Archived Out"]);
    expect(filterInventory(mixed, { search: "", status: "in", archive: "archived" }).map((i) => i.name))
      .toEqual(["Archived Stocked"]);
  });

  it("treats an item with no archivedAt field as active", () => {
    expect(filterInventory(items, { search: "", status: "all", archive: "active" })).toHaveLength(3);
    expect(filterInventory(items, { search: "", status: "all", archive: "archived" })).toHaveLength(0);
  });

  it("does not mutate the input", () => {
    const copy = [...items];
    filterInventory(items, { search: "x", status: "out" });
    expect(items).toEqual(copy);
  });
});
