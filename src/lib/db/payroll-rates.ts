import type { DB } from "./connection";
import type { PayrollBasis } from "./payroll";

/** Defaults that pre-fill the entry form. Nothing at report time reads these --
 *  an entry stores the rate it was actually paid at, so changing a default
 *  never rewrites history. */
export interface PayrollRate { person: string; basis: PayrollBasis; rateCents: number }

export function listPayrollRates(db: DB): PayrollRate[] {
  return db.prepare(
    "SELECT person, basis, rate_cents AS rateCents FROM payroll_rates ORDER BY person ASC, basis ASC"
  ).all() as PayrollRate[];
}

export function setPayrollRate(db: DB, person: string, basis: PayrollBasis, rateCents: number): void {
  db.prepare(`INSERT INTO payroll_rates (person, basis, rate_cents) VALUES (?,?,?)
    ON CONFLICT(person, basis) DO UPDATE SET rate_cents = excluded.rate_cents`)
    .run(person.trim(), basis, rateCents);
}

export function deletePayrollRate(db: DB, person: string, basis: PayrollBasis): void {
  db.prepare("DELETE FROM payroll_rates WHERE person = ? AND basis = ?").run(person.trim(), basis);
}
