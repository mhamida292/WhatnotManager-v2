import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { listPayrollRates, setPayrollRate, deletePayrollRate } from "@/lib/db/payroll-rates";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("payroll rate defaults", () => {
  it("stores a rate per person per basis", () => {
    setPayrollRate(db, "Ahmed", "hour", 1800);
    setPayrollRate(db, "Ahmed", "piece", 15);
    setPayrollRate(db, "Sara", "piece", 20);
    expect(listPayrollRates(db)).toEqual([
      { person: "Ahmed", basis: "hour", rateCents: 1800 },
      { person: "Ahmed", basis: "piece", rateCents: 15 },
      { person: "Sara", basis: "piece", rateCents: 20 },
    ]);
  });

  it("overwrites rather than duplicating an existing person and basis", () => {
    setPayrollRate(db, "Ahmed", "piece", 15);
    setPayrollRate(db, "Ahmed", "piece", 18);
    expect(listPayrollRates(db)).toEqual([{ person: "Ahmed", basis: "piece", rateCents: 18 }]);
  });

  it("trims the person so 'Ahmed ' does not become a second worker", () => {
    setPayrollRate(db, "Ahmed", "piece", 15);
    setPayrollRate(db, "  Ahmed  ", "piece", 18);
    expect(listPayrollRates(db)).toEqual([{ person: "Ahmed", basis: "piece", rateCents: 18 }]);
  });

  it("deletes one basis without disturbing the others", () => {
    setPayrollRate(db, "Ahmed", "hour", 1800);
    setPayrollRate(db, "Ahmed", "piece", 15);
    deletePayrollRate(db, "Ahmed", "piece");
    expect(listPayrollRates(db)).toEqual([{ person: "Ahmed", basis: "hour", rateCents: 1800 }]);
  });
});
