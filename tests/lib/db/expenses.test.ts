import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertExpense, listExpenses, totalExpensesCents,
  getExpense, updateExpense, deleteExpense, expensesByCategory } from "@/lib/db/expenses";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("expenses", () => {
  it("sums expenses including negative offsets (the $400 incentive)", () => {
    insertExpense(db, { description: "Shipping supplies", type: "one_time", category: "shipping", amountCents: 5000 });
    insertExpense(db, { description: "Streaming setup", type: "one_time", category: "equipment", amountCents: 12000 });
    insertExpense(db, { description: "Whatnot incentive", type: "one_time", category: "incentive", amountCents: -40000 });
    expect(totalExpensesCents(db)).toBe(5000 + 12000 - 40000);
    expect(listExpenses(db)).toHaveLength(3);
  });
});

describe("expense edit/delete", () => {
  it("updates and deletes an expense", () => {
    const id = insertExpense(db, { description: "Ring light", type: "one_time", category: "Equipment", amountCents: 7500 });
    updateExpense(db, id, { description: "Ring light XL", type: "one_time", category: "Equipment", amountCents: 8000, incurredOn: "2026-07-01" });
    expect(getExpense(db, id)).toMatchObject({ description: "Ring light XL", amountCents: 8000, incurredOn: "2026-07-01" });
    deleteExpense(db, id);
    expect(getExpense(db, id)).toBeNull();
  });
});

describe("insight queries", () => {
  beforeEach(() => {
    insertExpense(db, { description: "A", type: "one_time", category: "Shipping", amountCents: 1000, incurredOn: "2026-07-02" });
    insertExpense(db, { description: "B", type: "one_time", category: "Shipping", amountCents: 2000, incurredOn: "2026-07-20" });
    insertExpense(db, { description: "C", type: "one_time", category: "Displays", amountCents: 2000, incurredOn: "2026-06-15" });
    insertExpense(db, { description: "D", type: "one_time", category: null, amountCents: 300, incurredOn: null });
  });
  it("totals a date range inclusively, excluding null dates", () => {
    expect(totalExpensesCents(db, { from: "2026-07-01", to: "2026-07-31" })).toBe(3000);
  });
  it("totals everything with no range (including null dates)", () => {
    expect(totalExpensesCents(db)).toBe(5300);
  });
  it("breaks down by category, null => Uncategorized, desc by total", () => {
    const rows = expensesByCategory(db);
    expect(rows[0]).toEqual({ category: "Shipping", totalCents: 3000 });
    expect(rows.find((r) => r.category === "Uncategorized")).toEqual({ category: "Uncategorized", totalCents: 300 });
  });
  it("merges empty string and null categories into single Uncategorized row", () => {
    // Add an expense with empty string category
    insertExpense(db, { description: "E", type: "one_time", category: "", amountCents: 500, incurredOn: "2026-07-03" });
    const rows = expensesByCategory(db);
    // Should have exactly one "Uncategorized" row with the sum of both null and empty string expenses
    const uncategorized = rows.filter((r) => r.category === "Uncategorized");
    expect(uncategorized).toHaveLength(1);
    expect(uncategorized[0]).toEqual({ category: "Uncategorized", totalCents: 800 }); // 300 (null) + 500 (empty string)
  });
  it("listExpenses with range returns only in-range rows, excludes null-dated", () => {
    const rows = listExpenses(db, { from: "2026-07-01", to: "2026-07-31" });
    // A (2026-07-02) and B (2026-07-20) are in range; C (2026-06-15) and D (null) are excluded
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.description).sort()).toEqual(["A", "B"]);
  });
  it("listExpenses with no range returns all rows including null-dated", () => {
    const rows = listExpenses(db);
    expect(rows).toHaveLength(4);
  });
});
