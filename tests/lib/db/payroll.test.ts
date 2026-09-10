import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertPayroll, listPayroll, getPayroll, updatePayroll, deletePayroll,
  totalPayrollCents, owedPayrollCents, payrollByPerson, setPayrollPaid,
  type PayrollInput } from "@/lib/db/payroll";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

const shift = (over: Partial<PayrollInput> = {}): PayrollInput => ({
  person: "Sam", workDate: "2026-07-08", basis: "hour", qty: 5,
  startTime: "18:00", endTime: "23:00", rateCents: 1500, amountCents: 7500,
  note: null, ...over,
});

const piece = (over: Partial<PayrollInput> = {}): PayrollInput => ({
  person: "Sam", workDate: "2026-09-09", basis: "piece", qty: 300,
  startTime: null, endTime: null, rateCents: 15, amountCents: 4500,
  note: null, ...over,
});

describe("payroll DB layer", () => {
  it("inserts and reads back a shift", () => {
    const id = insertPayroll(db, shift({ note: "evening" }));
    expect(getPayroll(db, id)).toMatchObject({
      person: "Sam", workDate: "2026-07-08", basis: "hour", qty: 5,
      startTime: "18:00", endTime: "23:00", rateCents: 1500,
      amountCents: 7500, paidOn: null, note: "evening",
    });
  });

  it("inserts a piece entry with no clock times", () => {
    const id = insertPayroll(db, piece());
    expect(getPayroll(db, id)).toMatchObject({
      basis: "piece", qty: 300, startTime: null, endTime: null, amountCents: 4500,
    });
  });

  it("inserts a package entry", () => {
    const id = insertPayroll(db, piece({ basis: "package", qty: 120, rateCents: 50, amountCents: 6000 }));
    expect(getPayroll(db, id)).toMatchObject({ basis: "package", qty: 120, amountCents: 6000 });
  });

  it("updates and deletes", () => {
    const id = insertPayroll(db, shift());
    updatePayroll(db, id, shift({ person: "Alex", qty: 6, amountCents: 9000, endTime: "00:00" }));
    expect(getPayroll(db, id)).toMatchObject({ person: "Alex", qty: 6, amountCents: 9000 });
    deletePayroll(db, id);
    expect(getPayroll(db, id)).toBeNull();
  });

  it("marks paid and unpaid without touching anything else", () => {
    const id = insertPayroll(db, piece());
    setPayrollPaid(db, id, "2026-09-12");
    expect(getPayroll(db, id)).toMatchObject({ paidOn: "2026-09-12", amountCents: 4500 });
    setPayrollPaid(db, id, null);
    expect(getPayroll(db, id)!.paidOn).toBeNull();
  });

  it("keeps the paid date across an edit", () => {
    const id = insertPayroll(db, piece());
    setPayrollPaid(db, id, "2026-09-12");
    updatePayroll(db, id, piece({ qty: 400, amountCents: 6000 }));
    expect(getPayroll(db, id)).toMatchObject({ qty: 400, paidOn: "2026-09-12" });
  });

  it("filters, totals, and groups by work_date", () => {
    insertPayroll(db, shift({ workDate: "2026-07-01", amountCents: 40500 }));
    insertPayroll(db, shift({ workDate: "2026-07-08", amountCents: 45000 }));
    insertPayroll(db, shift({ person: "Alex", workDate: "2026-07-08", amountCents: 50000 }));
    insertPayroll(db, shift({ workDate: "2026-06-30", amountCents: 15000 }));

    const july = { from: "2026-07-01", to: "2026-07-31" };
    expect(listPayroll(db, july)).toHaveLength(3);
    expect(totalPayrollCents(db, july)).toBe(40500 + 45000 + 50000);
    expect(payrollByPerson(db, july)).toEqual([
      { person: "Alex", totalCents: 50000, owedCents: 50000 },
      { person: "Sam", totalCents: 85500, owedCents: 85500 },
    ].sort((a, b) => b.totalCents - a.totalCents));
  });

  it("counts only unpaid entries as owed, and respects the range", () => {
    const a = insertPayroll(db, shift({ workDate: "2026-07-08", amountCents: 6000 }));
    insertPayroll(db, shift({ workDate: "2026-07-09", amountCents: 4500 }));
    insertPayroll(db, shift({ workDate: "2026-06-30", amountCents: 9900 }));
    setPayrollPaid(db, a, "2026-07-10");

    const july = { from: "2026-07-01", to: "2026-07-31" };
    expect(totalPayrollCents(db, july)).toBe(10500);
    expect(owedPayrollCents(db, july)).toBe(4500);
    expect(owedPayrollCents(db)).toBe(4500 + 9900);
  });

  it("reports owed per person alongside earned", () => {
    const a = insertPayroll(db, shift({ person: "Ahmed", amountCents: 6000 }));
    insertPayroll(db, shift({ person: "Ahmed", amountCents: 4500 }));
    const s = insertPayroll(db, shift({ person: "Sara", amountCents: 9900 }));
    setPayrollPaid(db, a, "2026-07-10");
    setPayrollPaid(db, s, "2026-07-10");

    expect(payrollByPerson(db)).toEqual([
      { person: "Sara", totalCents: 9900, owedCents: 0 },
      { person: "Ahmed", totalCents: 10500, owedCents: 4500 },
    ].sort((a, b) => b.totalCents - a.totalCents));
  });
});
