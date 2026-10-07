import { describe, it, expect } from "vitest";
import { filterMappings, sortMappings, type MappingRow } from "@/lib/calc/mapping-list";

const row = (p: Partial<MappingRow> & { id: number }): MappingRow =>
  ({ productName: "", itemId: 1, itemName: "", archived: false, saleCount: 0, lastSoldOn: null, ...p });

const donut = row({ id: 1, productName: "CRUNCHY DONUT", itemName: "Crispy Donut", saleCount: 184, lastSoldOn: "2026-09-15" });
const wax = row({ id: 2, productName: "CRUNCHY WAX DONUT", itemName: "Crispy Donut", saleCount: 122, lastSoldOn: "2026-09-22" });
const cat = row({ id: 3, productName: "MINI CAT", itemName: "Archived Cat", archived: true, saleCount: 0, lastSoldOn: null });

describe("filterMappings", () => {
  it("matches the Whatnot name or the item name, case-insensitively", () => {
    expect(filterMappings([donut, wax, cat], "wax", "all").map((r) => r.id)).toEqual([2]);
    expect(filterMappings([donut, wax, cat], "crispy", "all").map((r) => r.id)).toEqual([1, 2]);
  });

  it("filters by the item's archive state", () => {
    expect(filterMappings([donut, wax, cat], "", "active").map((r) => r.id)).toEqual([1, 2]);
    expect(filterMappings([donut, wax, cat], "", "archived").map((r) => r.id)).toEqual([3]);
  });
});

describe("sortMappings", () => {
  const rows = [cat, wax, donut];

  it("sorts by text columns", () => {
    expect(sortMappings(rows, "productName", "asc").map((r) => r.id)).toEqual([1, 2, 3]);
    // same item: falls back to Whatnot name
    expect(sortMappings(rows, "itemName", "asc").map((r) => r.id)).toEqual([3, 1, 2]);
  });

  it("sorts by sales", () => {
    expect(sortMappings(rows, "saleCount", "desc").map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("keeps never-sold names last whichever way last-sold is sorted", () => {
    expect(sortMappings(rows, "lastSoldOn", "desc").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortMappings(rows, "lastSoldOn", "asc").map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
