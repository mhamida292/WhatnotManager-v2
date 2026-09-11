import { PAYROLL_BASES } from "@/lib/db/payroll";
import type { PayrollBasis } from "@/lib/db/payroll";

/** Re-exported from the type's home so existing consumers (and this module's
 *  own test) keep working unchanged. In the order the form offers them. */
export { PAYROLL_BASES };

const LABELS: Record<PayrollBasis, string> = { hour: "Hour", piece: "Piece", package: "Package" };
const PLURALS: Record<PayrollBasis, string> = { hour: "Hours", piece: "Pieces", package: "Packages" };
const RATES: Record<PayrollBasis, string> = { hour: "$/hr", piece: "$/piece", package: "$/package" };
const SINGULARS: Record<PayrollBasis, string> = { hour: "hr", piece: "piece", package: "package" };

export function basisLabel(basis: PayrollBasis): string { return LABELS[basis]; }

/** The form's quantity field label. */
export function qtyLabel(basis: PayrollBasis): string { return PLURALS[basis]; }

export function rateLabel(basis: PayrollBasis): string { return RATES[basis]; }

/** The table's Work cell. Hours keep two decimals because a shift is rarely
 *  whole; counts are integers and grouped, since piece jobs run to thousands. */
export function workLabel(basis: PayrollBasis, qty: number): string {
  if (basis === "hour") return `${qty.toFixed(2)} hrs`;
  const noun = qty === 1 ? SINGULARS[basis] : PLURALS[basis].toLowerCase();
  return `${qty.toLocaleString("en-US")} ${noun}`;
}
