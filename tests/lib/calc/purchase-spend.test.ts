import { describe, it, expect } from "vitest";
import { periodicSpend } from "@/lib/calc/purchase-spend";

const inv = (invoiceDate: string | null, total: number) => ({ invoiceDate, total });

describe("periodicSpend", () => {
  const rows = [
    inv("2026-09-21", 145800),
    inv("2026-09-15", 125000),
    inv("2026-08-19", 60000),
    inv("2026-07-08", 149376),
  ];

  it("totals the month the date falls in", () => {
    const s = periodicSpend(rows, "2026-09-22");
    expect(s.thisMonthCents).toBe(145800 + 125000);
    expect(s.thisMonthCount).toBe(2);
  });

  it("totals the previous month separately", () => {
    const s = periodicSpend(rows, "2026-09-22");
    expect(s.lastMonthCents).toBe(60000);
    expect(s.lastMonthCount).toBe(1);
  });

  it("rolls the previous month back across a year boundary", () => {
    const s = periodicSpend([inv("2025-12-30", 500), inv("2026-01-02", 900)], "2026-01-15");
    expect(s.thisMonthCents).toBe(900);
    expect(s.lastMonthCents).toBe(500);
  });

  it("reports lifetime spend and invoice count", () => {
    const s = periodicSpend(rows, "2026-09-22");
    expect(s.lifetimeCents).toBe(145800 + 125000 + 60000 + 149376);
    expect(s.lifetimeCount).toBe(4);
  });

  // Averaging over elapsed months, not over months that happen to have rows,
  // so a month with no buying still drags the average down honestly.
  it("averages across the months spanned, including empty ones", () => {
    const s = periodicSpend([inv("2026-06-01", 300), inv("2026-09-01", 300)], "2026-09-22");
    expect(s.monthsSpanned).toBe(4);           // Jun, Jul, Aug, Sep
    expect(s.avgPerMonthCents).toBe(150);      // 600 over 4
  });

  it("compares this month with last as a percentage", () => {
    const s = periodicSpend([inv("2026-08-01", 1000), inv("2026-09-01", 2500)], "2026-09-22");
    expect(s.changePct).toBe(150);
  });

  it("has no percentage when last month had no spend", () => {
    const s = periodicSpend([inv("2026-09-01", 2500)], "2026-09-22");
    expect(s.changePct).toBeNull();
  });

  it("ignores invoices with no date", () => {
    const s = periodicSpend([inv(null, 9999), inv("2026-09-01", 100)], "2026-09-22");
    expect(s.thisMonthCents).toBe(100);
    expect(s.lifetimeCents).toBe(100);
  });

  it("returns zeroes for no invoices", () => {
    const s = periodicSpend([], "2026-09-22");
    expect(s.thisMonthCents).toBe(0);
    expect(s.lifetimeCents).toBe(0);
    expect(s.avgPerMonthCents).toBe(0);
    expect(s.changePct).toBeNull();
  });
});
