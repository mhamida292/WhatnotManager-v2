import { describe, it, expect } from "vitest";
import { rowLabel, matchesSearch, sortCountRows, type CountItem } from "@/lib/calc/count-sheet";

const item = (p: Partial<CountItem> & { id: number; name: string }): CountItem =>
  ({ sku: null, aliases: [], expected: 0, ...p });

const donut = item({ id: 1, name: "Crispy Donut (Little)", sku: "ITEM-00001",
  aliases: ["CRUNCHY DONUT✨🍩", "CRUNCHY WAX DONUT✨🍩"], expected: 12 });
const cat = item({ id: 2, name: "Squish Cat", sku: "ITEM-00002", aliases: ["MINI SQUISH CAT 🐱"], expected: 40 });
const bare = item({ id: 3, name: "Unmapped Thing", expected: 5 });

describe("rowLabel", () => {
  it("shows the first (most recently sold) Whatnot alias and the rest as others", () => {
    expect(rowLabel(donut, "whatnot")).toEqual({ text: "CRUNCHY DONUT✨🍩", fallback: false, others: ["CRUNCHY WAX DONUT✨🍩"] });
  });

  it("shows the item name or sku by mode", () => {
    expect(rowLabel(donut, "name")).toEqual({ text: "Crispy Donut (Little)", fallback: false, others: [] });
    expect(rowLabel(donut, "sku")).toEqual({ text: "ITEM-00001", fallback: false, others: [] });
  });

  it("falls back to the item name when there is no Whatnot name or sku", () => {
    expect(rowLabel(bare, "whatnot")).toEqual({ text: "Unmapped Thing", fallback: true, others: [] });
    expect(rowLabel(bare, "sku")).toEqual({ text: "Unmapped Thing", fallback: true, others: [] });
  });
});

describe("matchesSearch", () => {
  it("matches every row on a blank query", () => {
    expect(matchesSearch(donut, "   ")).toBe(true);
  });

  it("matches name, sku and any alias, case-insensitively, whatever is displayed", () => {
    expect(matchesSearch(donut, "crispy")).toBe(true);
    expect(matchesSearch(donut, "00001")).toBe(true);
    expect(matchesSearch(donut, "crunchy wax")).toBe(true);
    expect(matchesSearch(donut, "cat")).toBe(false);
  });
});

describe("sortCountRows", () => {
  const rows = [donut, cat, bare];

  it("sorts by the displayed label", () => {
    expect(sortCountRows(rows, "whatnot", "name", {}).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortCountRows(rows, "name", "name", {}).map((r) => r.id)).toEqual([1, 2, 3]);
    // sku mode: ITEM-00001, ITEM-00002, then bare falls back to "Unmapped Thing"
    expect(sortCountRows(rows, "sku", "name", {}).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("sorts by expected both ways", () => {
    expect(sortCountRows(rows, "whatnot", "expected-desc", {}).map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortCountRows(rows, "whatnot", "expected-asc", {}).map((r) => r.id)).toEqual([3, 1, 2]);
  });

  it("puts counted rows that are off first, biggest miss first, then the rest by label", () => {
    // donut off by 2, cat matches, bare off by 4
    const counts = { 1: "10", 2: "40", 3: "1" };
    expect(sortCountRows(rows, "whatnot", "off-first", counts).map((r) => r.id)).toEqual([3, 1, 2]);
    // blank counts are not "off"
    expect(sortCountRows(rows, "whatnot", "off-first", { 2: "39", 3: " " }).map((r) => r.id)).toEqual([2, 1, 3]);
  });

  it("does not mutate its input", () => {
    const input = [bare, cat, donut];
    sortCountRows(input, "whatnot", "name", {});
    expect(input.map((r) => r.id)).toEqual([3, 2, 1]);
  });
});
