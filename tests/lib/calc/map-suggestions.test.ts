import { describe, it, expect } from "vitest";
import { buildMapSuggestions } from "@/lib/calc/map-suggestions";

const ITEMS = [
  { id: 1, name: "Highland Cow" },
  { id: 2, name: "Cheese Block" },
  { id: 3, name: "Axolotl" },
];

describe("buildMapSuggestions", () => {
  it("suggests the best-match item for each unmapped name", () => {
    const out = buildMapSuggestions(["Highland Cow Squishy (Assorted Colors)"], ITEMS);
    expect(out).toHaveLength(1);
    expect(out[0].suggestedItemId).toBe(1);
    expect(out[0].suggestedItemName).toBe("Highland Cow");
    expect(out[0].score).toBeGreaterThan(0.5);
    expect(out[0].confident).toBe(true);
  });

  it("flags a weak match as not confident but still suggests the closest item", () => {
    const out = buildMapSuggestions(["Completely Unrelated Widget"], ITEMS);
    expect(out[0].suggestedItemId).not.toBeNull();
    expect(out[0].confident).toBe(false);
  });

  it("returns a null suggestion with score 0 when there are no items", () => {
    const out = buildMapSuggestions(["Anything"], []);
    expect(out[0]).toEqual({
      productName: "Anything",
      suggestedItemId: null,
      suggestedItemName: null,
      score: 0,
      confident: false,
    });
  });

  it("sorts worst-score-first, ties broken by product name", () => {
    const out = buildMapSuggestions(
      ["Highland Cow Squishy", "Zzz No Match Here", "Aaa No Match Either"],
      ITEMS,
    );
    // The two non-matches score low and sort before the strong Highland Cow match;
    // between the two low scorers, worst score first (Zzz < Aaa).
    expect(out.map((s) => s.productName)).toEqual([
      "Zzz No Match Here",
      "Aaa No Match Either",
      "Highland Cow Squishy",
    ]);
  });

  it("breaks a genuine score tie by product name ascending", () => {
    const items = [{ id: 1, name: "Cheese Block" }];
    // Both names normalize identically to the item → both score 1.0 (a real tie).
    const out = buildMapSuggestions(["Cheese Block", "cheese block"], items);
    expect(out[0].score).toBe(out[1].score);
    expect(out.map((s) => s.productName)).toEqual(["cheese block", "Cheese Block"]);
  });
});
