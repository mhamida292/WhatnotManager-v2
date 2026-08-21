import { describe, it, expect } from "vitest";
import { avgPerUnitCents } from "@/lib/calc/avg-per-unit";

describe("avgPerUnitCents", () => {
  it("divides revenue by qty, rounded to whole cents", () => {
    expect(avgPerUnitCents(7151, 24)).toBe(298); // 297.9 -> 298
    expect(avgPerUnitCents(1575, 6)).toBe(263);  // 262.5 -> 263
  });
  it("returns null for zero or negative qty", () => {
    expect(avgPerUnitCents(1000, 0)).toBeNull();
    expect(avgPerUnitCents(1000, -1)).toBeNull();
  });
});
