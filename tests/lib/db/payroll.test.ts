import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertPayroll, listPayroll, getPayroll, updatePayroll, deletePayroll,
  totalPayrollCents, payrollByPerson } from "@/lib/db/payroll";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

const shift = (over: Partial<Parameters<typeof insertPayroll>[1]> = {}) => ({
  person: "Sam", workDate: "2026-07-08", startTime: "18:00", endTime: "23:00",
  hours: 5, rateCents: 1500, amountCents: 7500, note: null, ...over,
});

describe("payroll DB layer", () => {
  it("inserts and reads back a shift", () => {
    const id = insertPayroll(db, shift({ note: "evening" }));
    expect(getPayroll(db, id)).toMatchObject({
      person: "Sam", workDate: "2026-07-08", startTime: "18:00", endTime: "23:00",
      hours: 5, rateCents: 1500, amountCents: 7500, note: "evening",
    });
  });

  it("updates and deletes", () => {
    const id = insertPayroll(db, shift());
    updatePayroll(db, id, shift({ person: "Alex", hours: 6, amountCents: 9000, endTime: "00:00" }));
    expect(getPayroll(db, id)).toMatchObject({ person: "Alex", hours: 6, amountCents: 9000 });
    deletePayroll(db, id);
    expect(getPayroll(db, id)).toBeNull();
  });

  it("filters, totals, and groups by work_date", () => {
    insertPayroll(db, shift({ workDate: "2026-07-01", amountCents: 40500 }));
    insertPayroll(db, shift({ workDate: "2026-07-08", amountCents: 45000 }));
    insertPayroll(db, shift({ person: "Alex", workDate: "2026-07-08", amountCents: 50000 }));
    insertPayroll(db, shift({ workDate: "2026-06-30", amountCents: 15000 }));

    const july = { from: "2026-07-01", to: "2026-07-31" };
    expect(listPayroll(db, july)).toHaveLength(3);
    expect(totalPayrollCents(db, july)).toBe(40500 + 45000 + 50000);
    // payrollByPerson orders by totalCents DESC, then person ASC.
    expect(payrollByPerson(db, july)).toEqual([
      { person: "Sam", totalCents: 85500 },
      { person: "Alex", totalCents: 50000 },
    ]);
    expect(totalPayrollCents(db)).toBe(40500 + 45000 + 50000 + 15000);
  });
});
