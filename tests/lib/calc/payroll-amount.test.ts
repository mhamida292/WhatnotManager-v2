import { describe, it, expect } from "vitest";
import { payrollAmountCents, parsePayrollInput } from "@/lib/calc/payroll-amount";

describe("payrollAmountCents", () => {
  it("multiplies quantity by rate and rounds to a cent", () => {
    expect(payrollAmountCents(30, 1500)).toBe(45000);
    expect(payrollAmountCents(2.5, 1333)).toBe(3333); // 3332.5 -> 3333
    expect(payrollAmountCents(333, 15)).toBe(4995);   // 333 pieces at 15c
  });
  it("returns 0 when quantity or rate is missing", () => {
    expect(payrollAmountCents(null, 1500)).toBe(0);
    expect(payrollAmountCents(10, null)).toBe(0);
    expect(payrollAmountCents(NaN, 1500)).toBe(0);
  });
});

const hourly = (over: Record<string, unknown> = {}) => ({
  person: "Sam", workDate: "2026-07-08", basis: "hour",
  startTime: "20:00", endTime: "01:00", rateCents: 1500, note: null, ...over,
});

const byPiece = (over: Record<string, unknown> = {}) => ({
  person: "Sam", workDate: "2026-09-09", basis: "piece",
  qty: 300, rateCents: 15, note: null, ...over,
});

const ok = (b: Record<string, unknown>) => {
  const p = parsePayrollInput(b);
  if (!p.ok) throw new Error(`expected ok, got: ${p.error}`);
  return p.value;
};

describe("parsePayrollInput — hourly", () => {
  it("derives qty from the clock times, including across midnight", () => {
    expect(ok(hourly())).toMatchObject({
      basis: "hour", qty: 5, startTime: "20:00", endTime: "01:00", amountCents: 7500,
    });
  });

  it("defaults a missing basis to hour, so an old client still works", () => {
    const { basis, ...noBasis } = hourly();
    expect(ok(noBasis)).toMatchObject({ basis: "hour", qty: 5 });
  });

  it("rejects equal start and end rather than reading it as 24 hours", () => {
    expect(parsePayrollInput(hourly({ startTime: "12:00", endTime: "12:00" })).ok).toBe(false);
  });

  it("rejects malformed times", () => {
    expect(parsePayrollInput(hourly({ endTime: "nope" })).ok).toBe(false);
  });
});

describe("parsePayrollInput — piece and package", () => {
  it("takes the count as qty and stores no clock times", () => {
    expect(ok(byPiece())).toEqual({
      person: "Sam", workDate: "2026-09-09", basis: "piece", qty: 300,
      startTime: null, endTime: null, rateCents: 15, amountCents: 4500, note: null,
    });
  });

  it("handles packages the same way", () => {
    expect(ok(byPiece({ basis: "package", qty: 120, rateCents: 50 })))
      .toMatchObject({ basis: "package", qty: 120, amountCents: 6000 });
  });

  it("ignores clock times sent alongside a count", () => {
    expect(ok(byPiece({ startTime: "20:00", endTime: "23:00" })))
      .toMatchObject({ startTime: null, endTime: null, qty: 300 });
  });

  it("rejects zero, negative and fractional counts", () => {
    expect(parsePayrollInput(byPiece({ qty: 0 })).ok).toBe(false);
    expect(parsePayrollInput(byPiece({ qty: -5 })).ok).toBe(false);
    expect(parsePayrollInput(byPiece({ qty: 2.5 })).ok).toBe(false);
    expect(parsePayrollInput(byPiece({ qty: "many" })).ok).toBe(false);
  });
});

describe("parsePayrollInput — shared rules", () => {
  it("rejects a missing person, a bad date and a non-positive rate on every basis", () => {
    for (const make of [hourly, byPiece]) {
      expect(parsePayrollInput(make({ person: "   " })).ok).toBe(false);
      expect(parsePayrollInput(make({ workDate: "07/08/2026" })).ok).toBe(false);
      expect(parsePayrollInput(make({ rateCents: 0 })).ok).toBe(false);
      expect(parsePayrollInput(make({ rateCents: -5 })).ok).toBe(false);
    }
  });

  it("rejects an unknown basis", () => {
    expect(parsePayrollInput(byPiece({ basis: "widget" })).ok).toBe(false);
  });

  it("ignores a client-supplied amount", () => {
    expect(ok(byPiece({ amountCents: 999999 })).amountCents).toBe(4500);
    expect(ok(hourly({ amountCents: 999999, qty: 99 })).amountCents).toBe(7500);
  });

  it("rejects an hourly shift whose pay rounds down to nothing", () => {
    expect(parsePayrollInput(hourly({ startTime: "12:00", endTime: "12:01", rateCents: 1 })).ok).toBe(false);
  });

  it("still accepts a legitimately tiny but non-zero amount", () => {
    expect(ok(byPiece({ qty: 1, rateCents: 1 })).amountCents).toBe(1);
  });
});
