import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertExpense, getExpense, setReimbursed, amountsOwedByPerson, updateExpense } from "@/lib/db/expenses";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("expense reimbursement", () => {
  it("defaults reimbursable off and reimbursedOn null", () => {
    const id = insertExpense(db, { description: "Tape", type: "one_time", amountCents: 500 });
    expect(getExpense(db, id)).toMatchObject({ paidBy: null, reimbursable: 0, reimbursedOn: null });
  });

  it("stores paidBy + reimbursable and toggles reimbursed", () => {
    const id = insertExpense(db, { description: "Fuel", type: "one_time", amountCents: 4000, paidBy: "Sam", reimbursable: 1 });
    expect(getExpense(db, id)).toMatchObject({ paidBy: "Sam", reimbursable: 1, reimbursedOn: null });
    setReimbursed(db, id, "2026-07-16");
    expect(getExpense(db, id)?.reimbursedOn).toBe("2026-07-16");
    setReimbursed(db, id, null);
    expect(getExpense(db, id)?.reimbursedOn).toBeNull();
  });

  it("who's-owed sums only reimbursable + outstanding, grouped by person, desc", () => {
    insertExpense(db, { description: "a", type: "one_time", amountCents: 4000, paidBy: "Sam", reimbursable: 1 });
    insertExpense(db, { description: "b", type: "one_time", amountCents: 1000, paidBy: "Sam", reimbursable: 1 });
    insertExpense(db, { description: "c", type: "one_time", amountCents: 9000, paidBy: "Alex", reimbursable: 1 });
    // reimbursed => excluded:
    const paid = insertExpense(db, { description: "d", type: "one_time", amountCents: 9999, paidBy: "Sam", reimbursable: 1 });
    setReimbursed(db, paid, "2026-07-01");
    // not reimbursable => excluded:
    insertExpense(db, { description: "e", type: "one_time", amountCents: 8888, paidBy: "Sam", reimbursable: 0 });
    expect(amountsOwedByPerson(db)).toEqual([
      { person: "Alex", totalCents: 9000 },
      { person: "Sam", totalCents: 5000 },
    ]);
  });

  it("preserves paidBy/reimbursable/reimbursedOn when editing base fields (regression: PATCH route bug)", () => {
    const id = insertExpense(db, {
      description: "Fuel", type: "one_time", amountCents: 4000, paidBy: "Sam", reimbursable: 1,
    });
    const existing = getExpense(db, id)!;
    // Simulate the edit path: base fields changed, reimbursement fields read back and passed through unchanged.
    updateExpense(db, id, {
      description: "Fuel (edited)", type: "one_time", category: null, amountCents: 5000,
      incurredOn: existing.incurredOn,
      paidBy: existing.paidBy, reimbursable: existing.reimbursable, reimbursedOn: existing.reimbursedOn,
    });
    const after = getExpense(db, id);
    expect(after).toMatchObject({
      description: "Fuel (edited)", amountCents: 5000,
      paidBy: "Sam", reimbursable: 1, reimbursedOn: null,
    });
    expect(amountsOwedByPerson(db)).toEqual([{ person: "Sam", totalCents: 5000 }]);
  });
});
