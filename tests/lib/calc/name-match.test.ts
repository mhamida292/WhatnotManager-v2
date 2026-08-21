import { describe, it, expect } from "vitest";
import { score, bestMatch, MATCH_THRESHOLD } from "@/lib/calc/name-match";

const items = [
  { id: 1, name: "Cheese" },
  { id: 2, name: "Highland Cow" },
  { id: 3, name: "Viral Mystery" },
  { id: 4, name: "Orbeez Stuffed" },
  { id: 5, name: "Pushy Squishy Ice Cream" },
];

describe("score", () => {
  it("scores an exact normalized match as 1", () => {
    expect(score("Cheese", "cheese")).toBe(1);
  });

  it("scores a noise-word variant highly", () => {
    expect(score("Cheese Squishy", "Cheese")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("scores unrelated names below threshold", () => {
    expect(score("Highland Cow", "Cheese")).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe("bestMatch", () => {
  it("returns null for empty item list", () => {
    expect(bestMatch("Cheese Squishy", [])).toBeNull();
  });

  it("picks the right item for noise-laden Whatnot names", () => {
    expect(bestMatch("Cheese Squishy", items)?.itemId).toBe(1);
    expect(bestMatch("Highland Cow Squishy (Assorted Colors)", items)?.itemId).toBe(2);
    expect(bestMatch("Viral Mystery Dumpling (Assorted Colors)", items)?.itemId).toBe(3);
    expect(bestMatch("Orbeez Stuffed Glitter Dumpling", items)?.itemId).toBe(4);
  });

  it("ranks the correct item above the others", () => {
    const m = bestMatch("Highland Cow Squishy (Assorted Colors)", items)!;
    const cheese = score("Highland Cow Squishy (Assorted Colors)", "Cheese");
    expect(m.score).toBeGreaterThan(cheese);
  });
});
