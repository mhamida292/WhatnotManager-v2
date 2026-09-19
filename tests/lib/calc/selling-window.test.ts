import { describe, it, expect } from "vitest";
import { sellingWindow, formatMinutes } from "@/lib/calc/selling-window";

const at = (h: number, m = 0) => h * 3600 + m * 60;

describe("sellingWindow", () => {
  it("spans the first sale to the last", () => {
    const w = sellingWindow([at(22, 1), at(22, 30), at(22, 56)], 103);
    expect(w.minutes).toBe(55);
  });

  it("derives units per hour from the span", () => {
    const w = sellingWindow([at(20), at(22)], 240); // 2h
    expect(w.minutes).toBe(120);
    expect(w.unitsPerHour).toBe(120);
  });

  it("ignores the order the times arrive in", () => {
    const w = sellingWindow([at(22, 56), at(22, 1), at(22, 30)], 10);
    expect(w.minutes).toBe(55);
  });

  it("has no window for a single sale", () => {
    const w = sellingWindow([at(22)], 1);
    expect(w.minutes).toBeNull();
    expect(w.unitsPerHour).toBeNull();
  });

  it("has no window with no sales at all", () => {
    const w = sellingWindow([], 0);
    expect(w.minutes).toBeNull();
    expect(w.unitsPerHour).toBeNull();
  });

  // Several sales inside the same minute would divide by zero.
  it("reports a zero-length window without an infinite rate", () => {
    const w = sellingWindow([at(22), at(22)], 5);
    expect(w.minutes).toBe(0);
    expect(w.unitsPerHour).toBeNull();
  });

  it("rounds units per hour to a whole number", () => {
    const w = sellingWindow([at(22), at(22, 55)], 103); // 103 / 55 * 60 = 112.36
    expect(w.unitsPerHour).toBe(112);
  });
});

describe("formatMinutes", () => {
  it("shows minutes alone under an hour", () => {
    expect(formatMinutes(55)).toBe("55m");
    expect(formatMinutes(0)).toBe("0m");
  });

  it("splits hours and minutes past an hour", () => {
    expect(formatMinutes(60)).toBe("1h 0m");
    expect(formatMinutes(87)).toBe("1h 27m");
    expect(formatMinutes(195)).toBe("3h 15m");
  });
});
