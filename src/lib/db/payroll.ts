import type { DB } from "./connection";

export type PayrollBasis = "hour" | "piece" | "package";

export interface PayrollRow {
  id: number; person: string; workDate: string;
  basis: PayrollBasis; qty: number;
  startTime: string | null; endTime: string | null;
  rateCents: number; amountCents: number;
  paidOn: string | null; note: string | null;
}

/** paid_on is deliberately outside the input type: it moves through
 *  setPayrollPaid alone, so editing an entry can never clear its paid date. */
export type PayrollInput = Omit<PayrollRow, "id" | "paidOn">;
export type PayrollDateRange = { from?: string; to?: string };

/** Filter on the day the work was done. */
function rangeClause(range?: PayrollDateRange): { sql: string; args: string[] } {
  if (!range || (!range.from && !range.to)) return { sql: "", args: [] };
  const parts: string[] = [];
  const args: string[] = [];
  if (range.from) { parts.push("work_date >= ?"); args.push(range.from); }
  if (range.to) { parts.push("work_date <= ?"); args.push(range.to); }
  return { sql: " WHERE " + parts.join(" AND "), args };
}

const COLS = `id, person, work_date AS workDate, basis, qty,
  start_time AS startTime, end_time AS endTime, rate_cents AS rateCents,
  amount_cents AS amountCents, paid_on AS paidOn, note`;

export function insertPayroll(db: DB, e: PayrollInput): number {
  const info = db.prepare(`INSERT INTO payroll_entries
    (person, work_date, basis, qty, start_time, end_time, rate_cents, amount_cents, note)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
      e.person.trim(), e.workDate, e.basis, e.qty,
      e.startTime, e.endTime, e.rateCents, e.amountCents, e.note?.trim() || null);
  return Number(info.lastInsertRowid);
}

export function listPayroll(db: DB, range?: PayrollDateRange): PayrollRow[] {
  const { sql, args } = rangeClause(range);
  return db.prepare(`SELECT ${COLS} FROM payroll_entries${sql}
    ORDER BY work_date DESC, start_time DESC, id DESC`).all(...args) as PayrollRow[];
}

export function getPayroll(db: DB, id: number): PayrollRow | null {
  const r = db.prepare(`SELECT ${COLS} FROM payroll_entries WHERE id = ?`).get(id) as PayrollRow | undefined;
  return r ?? null;
}

export function updatePayroll(db: DB, id: number, e: PayrollInput): void {
  db.prepare(`UPDATE payroll_entries SET person=?, work_date=?, basis=?, qty=?,
    start_time=?, end_time=?, rate_cents=?, amount_cents=?, note=? WHERE id=?`).run(
      e.person.trim(), e.workDate, e.basis, e.qty,
      e.startTime, e.endTime, e.rateCents, e.amountCents, e.note?.trim() || null, id);
}

/** A date stamps the entry paid; null returns it to owed. Touches nothing else. */
export function setPayrollPaid(db: DB, id: number, paidOn: string | null): void {
  db.prepare("UPDATE payroll_entries SET paid_on = ? WHERE id = ?").run(paidOn, id);
}

export function deletePayroll(db: DB, id: number): void {
  db.prepare("DELETE FROM payroll_entries WHERE id = ?").run(id);
}

export function totalPayrollCents(db: DB, range?: PayrollDateRange): number {
  const { sql, args } = rangeClause(range);
  const r = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM payroll_entries${sql}`).get(...args) as { t: number };
  return Number(r.t);
}

/** Wages logged but not yet marked paid. Bookkeeping only -- no report reads it. */
export function owedPayrollCents(db: DB, range?: PayrollDateRange): number {
  const { sql, args } = rangeClause(range);
  const where = sql ? `${sql} AND paid_on IS NULL` : " WHERE paid_on IS NULL";
  const r = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM payroll_entries${where}`).get(...args) as { t: number };
  return Number(r.t);
}

export function payrollByPerson(db: DB, range?: PayrollDateRange): { person: string; totalCents: number; owedCents: number }[] {
  const { sql, args } = rangeClause(range);
  const rows = db.prepare(
    `SELECT person,
            COALESCE(SUM(amount_cents),0) AS totalCents,
            COALESCE(SUM(CASE WHEN paid_on IS NULL THEN amount_cents ELSE 0 END),0) AS owedCents
     FROM payroll_entries${sql}
     GROUP BY person ORDER BY totalCents DESC, person ASC`
  ).all(...args) as { person: string; totalCents: number; owedCents: number }[];
  return rows.map((r) => ({ person: r.person, totalCents: Number(r.totalCents), owedCents: Number(r.owedCents) }));
}
