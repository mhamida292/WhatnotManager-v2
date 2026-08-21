import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertPayroll, listPayroll, getPayroll, updatePayroll, deletePayroll,
  totalPayrollCents, payrollByPerson } from "@/lib/db/payroll";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("payroll DB layer", () => {
  it("inserts and reads back an entry", () => {
    const id = insertPayroll(db, { person: "Sam", periodStart: "2026-07-08", periodEnd: "2026-07-14", hours: 30, rateCents: 1500, amountCents: 45000, note: "week" });
    expect(getPayroll(db, id)).toMatchObject({ person: "Sam", hours: 30, rateCents: 1500, amountCents: 45000, periodEnd: "2026-07-14" });
  });

  it("updates and deletes", () => {
    const id = insertPayroll(db, { person: "Sam", periodStart: null, periodEnd: "2026-07-14", hours: null, rateCents: null, amountCents: 20000, note: null });
    updatePayroll(db, id, { person: "Sam", periodStart: null, periodEnd: "2026-07-14", hours: null, rateCents: null, amountCents: 25000, note: "bonus" });
    expect(getPayroll(db, id)?.amountCents).toBe(25000);
    deletePayroll(db, id);
    expect(getPayroll(db, id)).toBeNull();
  });

  it("filters by month on period_end and totals/ groups by person", () => {
    insertPayroll(db, { person: "Sam", periodStart: "2026-07-01", periodEnd: "2026-07-07", hours: 27, rateCents: 1500, amountCents: 40500, note: null });
    insertPayroll(db, { person: "Sam", periodStart: "2026-07-08", periodEnd: "2026-07-14", hours: 30, rateCents: 1500, amountCents: 45000, note: null });
    insertPayroll(db, { person: "Alex", periodStart: "2026-07-08", periodEnd: "2026-07-14", hours: 25, rateCents: 2000, amountCents: 50000, note: null });
    insertPayroll(db, { person: "Sam", periodStart: "2026-06-24", periodEnd: "2026-06-30", hours: 10, rateCents: 1500, amountCents: 15000, note: null });
    const july = { from: "2026-07-01", to: "2026-07-31" };
    expect(totalPayrollCents(db, july)).toBe(40500 + 45000 + 50000);
    expect(listPayroll(db, july)).toHaveLength(3);
    expect(payrollByPerson(db, july)).toEqual([
      { person: "Sam", totalCents: 85500 },
      { person: "Alex", totalCents: 50000 },
    ]);
  });
});
