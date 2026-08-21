import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertExpense } from "@/lib/db/expenses";
import { listExpenseItems, replaceExpenseItems } from "@/lib/db/expense-items";

let db: DB;
let expenseId: number;
beforeEach(() => {
  db = createDb(":memory:");
  expenseId = insertExpense(db, { description: "Shipping materials", type: "one_time", category: "Shipping", amountCents: 8420 });
});

describe("expense items", () => {
  it("replaces items, preserving order and optional qty/price", () => {
    replaceExpenseItems(db, expenseId, [
      { name: "Bubble wrap", qty: 2, unitCents: 1100 },
      { name: "Misc tape", qty: null, unitCents: null },
    ]);
    const rows = listExpenseItems(db, expenseId);
    expect(rows.map((r) => r.name)).toEqual(["Bubble wrap", "Misc tape"]);
    expect(rows[0]).toMatchObject({ qty: 2, unitCents: 1100, sortOrder: 0 });
    expect(rows[1]).toMatchObject({ qty: null, unitCents: null, sortOrder: 1 });
  });

  it("skips rows with blank names and overwrites on re-save", () => {
    replaceExpenseItems(db, expenseId, [{ name: "First", qty: null, unitCents: null }]);
    replaceExpenseItems(db, expenseId, [
      { name: "  ", qty: 1, unitCents: 500 },
      { name: "Kept", qty: null, unitCents: null },
    ]);
    const rows = listExpenseItems(db, expenseId);
    expect(rows.map((r) => r.name)).toEqual(["Kept"]);
  });

  it("cascades on expense delete via foreign key", () => {
    replaceExpenseItems(db, expenseId, [{ name: "X", qty: null, unitCents: null }]);
    db.prepare("DELETE FROM expenses WHERE id = ?").run(expenseId);
    expect(listExpenseItems(db, expenseId)).toHaveLength(0);
  });
});
