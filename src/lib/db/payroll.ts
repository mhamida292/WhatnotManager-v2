import type { DB } from "./connection";

export interface PayrollRow {
  id: number; person: string; periodStart: string | null; periodEnd: string | null;
  hours: number | null; rateCents: number | null; amountCents: number; note: string | null;
}

export type PayrollDateRange = { from?: string; to?: string };

/** Filter on period_end, falling back to period_start when period_end is null. */
function rangeClause(range?: PayrollDateRange): { sql: string; args: string[] } {
  if (!range || (!range.from && !range.to)) return { sql: "", args: [] };
  const col = "COALESCE(period_end, period_start)";
  const parts: string[] = [`${col} IS NOT NULL`];
  const args: string[] = [];
  if (range.from) { parts.push(`${col} >= ?`); args.push(range.from); }
  if (range.to) { parts.push(`${col} <= ?`); args.push(range.to); }
  return { sql: " WHERE " + parts.join(" AND "), args };
}

const COLS = `id, person, period_start AS periodStart, period_end AS periodEnd,
  hours, rate_cents AS rateCents, amount_cents AS amountCents, note`;

export function insertPayroll(db: DB, e: {
  person: string; periodStart?: string | null; periodEnd?: string | null;
  hours?: number | null; rateCents?: number | null; amountCents: number; note?: string | null;
}): number {
  const info = db.prepare(`INSERT INTO payroll_entries
    (person, period_start, period_end, hours, rate_cents, amount_cents, note)
    VALUES (?,?,?,?,?,?,?)`).run(
      e.person.trim(), e.periodStart ?? null, e.periodEnd ?? null,
      e.hours ?? null, e.rateCents ?? null, e.amountCents, e.note?.trim() || null);
  return Number(info.lastInsertRowid);
}

export function listPayroll(db: DB, range?: PayrollDateRange): PayrollRow[] {
  const { sql, args } = rangeClause(range);
  return db.prepare(`SELECT ${COLS} FROM payroll_entries${sql}
    ORDER BY COALESCE(period_end, period_start) DESC, id DESC`).all(...args) as PayrollRow[];
}

export function getPayroll(db: DB, id: number): PayrollRow | null {
  const r = db.prepare(`SELECT ${COLS} FROM payroll_entries WHERE id = ?`).get(id) as PayrollRow | undefined;
  return r ?? null;
}

export function updatePayroll(db: DB, id: number, e: {
  person: string; periodStart: string | null; periodEnd: string | null;
  hours: number | null; rateCents: number | null; amountCents: number; note: string | null;
}): void {
  db.prepare(`UPDATE payroll_entries SET person=?, period_start=?, period_end=?, hours=?,
    rate_cents=?, amount_cents=?, note=? WHERE id=?`).run(
      e.person.trim(), e.periodStart ?? null, e.periodEnd ?? null, e.hours ?? null,
      e.rateCents ?? null, e.amountCents, e.note?.trim() || null, id);
}

export function deletePayroll(db: DB, id: number): void {
  db.prepare("DELETE FROM payroll_entries WHERE id = ?").run(id);
}

export function totalPayrollCents(db: DB, range?: PayrollDateRange): number {
  const { sql, args } = rangeClause(range);
  const r = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM payroll_entries${sql}`).get(...args) as { t: number };
  return Number(r.t);
}

export function payrollByPerson(db: DB, range?: PayrollDateRange): { person: string; totalCents: number }[] {
  const { sql, args } = rangeClause(range);
  const rows = db.prepare(
    `SELECT person, COALESCE(SUM(amount_cents),0) AS totalCents FROM payroll_entries${sql}
     GROUP BY person ORDER BY totalCents DESC, person ASC`
  ).all(...args) as { person: string; totalCents: number }[];
  return rows.map((r) => ({ person: r.person, totalCents: Number(r.totalCents) }));
}
