import { describe, it, expect } from "vitest";
import { toCents, toDollars, formatUSD } from "@/lib/money";

describe("money", () => {
  it("converts dollars to integer cents", () => {
    expect(toCents(2.5)).toBe(250);
    expect(toCents(732)).toBe(73200);
    expect(toCents(2.25)).toBe(225);
  });
  it("rounds to nearest cent (no float drift)", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
  it("rounds half-cent float edge case correctly", () => {
    expect(toCents(1.005)).toBe(101);
  });
  it("converts cents back to dollars", () => {
    expect(toDollars(250)).toBe(2.5);
  });
  it("formats USD", () => {
    expect(formatUSD(73200)).toBe("$732.00");
    expect(formatUSD(-500)).toBe("-$5.00");
    expect(formatUSD(956385)).toBe("$9,563.85");
    expect(formatUSD(1819796)).toBe("$18,197.96");
    expect(formatUSD(-59287)).toBe("-$592.87");
  });
});
