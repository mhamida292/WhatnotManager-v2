import type { DB } from "./connection";

export interface ExpenseRow {
  id: number; description: string; type: "one_time" | "recurring";
  category: string | null; amountCents: number; incurredOn: string | null;
  paidBy: string | null; reimbursable: number; reimbursedOn: string | null;
}

export function insertExpense(db: DB, e: {
  description: string; type: "one_time" | "recurring";
  category?: string | null; amountCents: number; incurredOn?: string | null;
  paidBy?: string | null; reimbursable?: number; reimbursedOn?: string | null;
}): number {
  const info = db.prepare(`INSERT INTO expenses
    (description,type,category,amount_cents,incurred_on,paid_by,reimbursable,reimbursed_on)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      e.description, e.type, e.category ?? null, e.amountCents, e.incurredOn ?? null,
      e.paidBy?.trim() || null, e.reimbursable ? 1 : 0, e.reimbursedOn ?? null);
  return Number(info.lastInsertRowid);
}

export function listExpenses(db: DB, range?: DateRange): ExpenseRow[] {
  const { sql, args } = rangeClause(range);
  return db.prepare(`SELECT id, description, type, category, amount_cents as amountCents,
    incurred_on as incurredOn, paid_by as paidBy, reimbursable,
    reimbursed_on as reimbursedOn FROM expenses${sql} ORDER BY incurred_on`).all(...args) as ExpenseRow[];
}

export function getExpense(db: DB, id: number): ExpenseRow | null {
  const r = db.prepare(`SELECT id, description, type, category, amount_cents as amountCents,
    incurred_on as incurredOn, paid_by as paidBy, reimbursable,
    reimbursed_on as reimbursedOn FROM expenses WHERE id = ?`).get(id) as ExpenseRow | undefined;
  return r ?? null;
}

export function updateExpense(db: DB, id: number, e: {
  description: string; type: "one_time" | "recurring";
  category: string | null; amountCents: number; incurredOn: string | null;
  paidBy?: string | null; reimbursable?: number; reimbursedOn?: string | null;
}): void {
  db.prepare(`UPDATE expenses SET description=?, type=?, category=?, amount_cents=?, incurred_on=?,
    paid_by=?, reimbursable=?, reimbursed_on=? WHERE id=?`).run(
      e.description, e.type, e.category ?? null, e.amountCents, e.incurredOn ?? null,
      e.paidBy?.trim() || null, e.reimbursable ? 1 : 0, e.reimbursedOn ?? null, id);
}

export function deleteExpense(db: DB, id: number): void {
  db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
}

export type DateRange = { from?: string; to?: string };

function rangeClause(range?: DateRange): { sql: string; args: string[] } {
  if (!range || (!range.from && !range.to)) return { sql: "", args: [] };
  const parts: string[] = ["incurred_on IS NOT NULL"];
  const args: string[] = [];
  if (range.from) { parts.push("incurred_on >= ?"); args.push(range.from); }
  if (range.to) { parts.push("incurred_on <= ?"); args.push(range.to); }
  return { sql: " WHERE " + parts.join(" AND "), args };
}

export function totalExpensesCents(db: DB, range?: DateRange): number {
  const { sql, args } = rangeClause(range);
  const r = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) as t FROM expenses${sql}`).get(...args) as { t: number };
  return Number(r.t);
}

export function expensesByCategory(db: DB, range?: DateRange): { category: string; totalCents: number }[] {
  const { sql, args } = rangeClause(range);
  const rows = db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(category),''),'Uncategorized') AS category,
       COALESCE(SUM(amount_cents),0) AS totalCents
     FROM expenses${sql} GROUP BY COALESCE(NULLIF(TRIM(category),''),'Uncategorized') ORDER BY totalCents DESC`
  ).all(...args) as { category: string; totalCents: number }[];
  return rows.map((r) => ({ category: r.category, totalCents: Number(r.totalCents) }));
}

/** Set (or clear, with null) the date an expense was reimbursed. */
export function setReimbursed(db: DB, id: number, on: string | null): void {
  db.prepare("UPDATE expenses SET reimbursed_on = ? WHERE id = ?").run(on ?? null, id);
}

/** Outstanding amounts owed to each person who fronted a reimbursable expense:
 *  reimbursable = 1 AND reimbursed_on IS NULL, grouped by paid_by, desc by total.
 *  Rows with no paid_by are ignored. */
export function amountsOwedByPerson(db: DB, range?: DateRange): { person: string; totalCents: number }[] {
  const { sql, args } = rangeClause(range);
  const where = sql ? `${sql} AND reimbursable = 1 AND reimbursed_on IS NULL AND TRIM(COALESCE(paid_by,'')) <> ''`
                    : ` WHERE reimbursable = 1 AND reimbursed_on IS NULL AND TRIM(COALESCE(paid_by,'')) <> ''`;
  const rows = db.prepare(
    `SELECT paid_by AS person, COALESCE(SUM(amount_cents),0) AS totalCents
     FROM expenses${where} GROUP BY paid_by ORDER BY totalCents DESC, person ASC`
  ).all(...args) as { person: string; totalCents: number }[];
  return rows.map((r) => ({ person: r.person, totalCents: Number(r.totalCents) }));
}
