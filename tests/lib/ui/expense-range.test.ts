import { describe, it, expect } from "vitest";
import { weekRange, currentIsoWeek, periodLabel, rangeFromParams } from "@/lib/ui/expense-range";

describe("weekRange", () => {
  it("expands an ISO week to Mon–Sun", () => {
    expect(weekRange("2026-W29")).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });
  it("handles a year-boundary week", () => {
    expect(weekRange("2026-W01")).toEqual({ from: "2025-12-29", to: "2026-01-04" });
  });
  it("returns undefined for malformed input", () => {
    expect(weekRange("2026-29")).toBeUndefined();
    expect(weekRange("")).toBeUndefined();
    expect(weekRange("2026-W99")).toBeUndefined();
  });
});

describe("currentIsoWeek", () => {
  it("returns the ISO week string for a given date", () => {
    expect(currentIsoWeek(new Date("2026-07-18T12:00:00Z"))).toBe("2026-W29");
    expect(currentIsoWeek(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01");
  });
  it("round-trips through weekRange", () => {
    const wk = currentIsoWeek(new Date("2026-07-18T12:00:00Z"));
    expect(weekRange(wk)).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });
});

describe("rangeFromParams week/all", () => {
  it("expands a week param", () => {
    expect(rangeFromParams({ week: "2026-W29" })).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });
  it("all short-circuits to undefined (all time)", () => {
    expect(rangeFromParams({ all: "1", week: "2026-W29" })).toBeUndefined();
  });
  it("week beats a simultaneously-present month", () => {
    expect(rangeFromParams({ week: "2026-W29", month: "2026-07" })).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });
  it("still expands month when no week", () => {
    expect(rangeFromParams({ month: "2026-07" })).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
});

describe("rangeFromParams", () => {
  it("expands a month to its full span", () => {
    expect(rangeFromParams({ month: "2026-07" })).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(rangeFromParams({ month: "2026-02" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("returns undefined for no params", () => {
    expect(rangeFromParams({})).toBeUndefined();
  });
});

describe("periodLabel", () => {
  it("labels each mode", () => {
    expect(periodLabel({ week: "2026-W29" })).toBe("this week");
    expect(periodLabel({ month: "2026-07" })).toBe("July 2026");
    expect(periodLabel({ all: "1" })).toBe("all time");
  });
});
