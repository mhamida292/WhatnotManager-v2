import type { DB } from "./connection";

export interface ExpenseItemRow {
  id: number; expenseId: number; name: string;
  qty: number | null; unitCents: number | null; sortOrder: number;
}

export function listExpenseItems(db: DB, expenseId: number): ExpenseItemRow[] {
  return db.prepare(
    `SELECT id, expense_id AS expenseId, name, qty, unit_cents AS unitCents, sort_order AS sortOrder
     FROM expense_items WHERE expense_id = ? ORDER BY sort_order, id`
  ).all(expenseId) as ExpenseItemRow[];
}

export function replaceExpenseItems(
  db: DB, expenseId: number,
  items: { name: string; qty: number | null; unitCents: number | null }[],
): void {
  const clean = items.filter((i) => i.name.trim() !== "");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM expense_items WHERE expense_id = ?").run(expenseId);
    const insert = db.prepare(
      "INSERT INTO expense_items (expense_id, name, qty, unit_cents, sort_order) VALUES (?,?,?,?,?)"
    );
    clean.forEach((i, idx) =>
      insert.run(expenseId, i.name.trim(), i.qty ?? null, i.unitCents ?? null, idx));
  });
  tx();
}
