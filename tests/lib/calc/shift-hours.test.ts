import { describe, it, expect } from "vitest";
import { shiftHours } from "@/lib/calc/payroll-amount";

describe("shiftHours", () => {
  it("measures a same-day shift", () => {
    expect(shiftHours("09:00", "17:30")).toBe(8.5);
    expect(shiftHours("9:00", "10:00")).toBe(1); // single-digit hour accepted
  });

  it("reads an end before the start as crossing midnight", () => {
    expect(shiftHours("20:00", "01:00")).toBe(5);
    expect(shiftHours("23:45", "00:15")).toBe(0.5);
  });

  it("treats equal start and end as zero, not a full day", () => {
    expect(shiftHours("12:00", "12:00")).toBe(0);
  });

  it("returns null for malformed times", () => {
    expect(shiftHours("", "10:00")).toBeNull();
    expect(shiftHours("abc", "10:00")).toBeNull();
    expect(shiftHours("25:00", "10:00")).toBeNull();
    expect(shiftHours("10:60", "11:00")).toBeNull();
    expect(shiftHours("10:00", "")).toBeNull();
  });
});
