import { describe, it, expect } from "vitest";
import { payrollAmountCents } from "@/lib/calc/payroll-amount";

describe("payrollAmountCents", () => {
  it("multiplies hours by rate and rounds to a cent", () => {
    expect(payrollAmountCents(30, 1500)).toBe(45000);
    expect(payrollAmountCents(2.5, 1333)).toBe(3333); // 3332.5 -> 3333
  });
  it("returns 0 when hours or rate is missing", () => {
    expect(payrollAmountCents(null, 1500)).toBe(0);
    expect(payrollAmountCents(10, null)).toBe(0);
    expect(payrollAmountCents(NaN, 1500)).toBe(0);
  });
});
