import type { PayrollBasis, PayrollInput } from "@/lib/db/payroll";

/** Auto-calculated gross pay in cents: quantity * rate, rounded. Returns 0 if either
 *  input is null/NaN (e.g. a flat entry with no quantity — caller sets amount directly). */
export function payrollAmountCents(qty: number | null, rateCents: number | null): number {
  if (qty == null || rateCents == null) return 0;
  const q = Number(qty), r = Number(rateCents);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return 0;
  return Math.round(q * r);
}

/** Minutes since midnight for an 'HH:MM' clock string; null if malformed. */
function clockMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Hours worked between two 'HH:MM' clock times. An end BEFORE the start means
 *  the shift crossed midnight (+24h) and still belongs to the start date. An end
 *  EQUAL to the start is 0, not 24 — a zero-length shift is a typo, and reading
 *  it as a full day would silently invent a day's wages. null when either time
 *  is malformed; callers reject rather than guess. */
export function shiftHours(start: string, end: string): number | null {
  const s = clockMinutes(start), e = clockMinutes(end);
  if (s == null || e == null) return null;
  if (e === s) return 0;
  const span = e > s ? e - s : e + 1440 - s;
  return span / 60;
}

const BASES: PayrollBasis[] = ["hour", "piece", "package"];

export type PayrollParse =
  | { ok: true; value: PayrollInput }
  | { ok: false; error: string };

/** Validate a payroll payload and DERIVE qty and amount from it. The client
 *  never gets to assert the amount -- that's what let the old form silently
 *  save $0 entries. An hour entry derives qty from its clock times; a piece or
 *  package entry takes a whole count and stores no times at all. */
export function parsePayrollInput(b: Record<string, unknown>): PayrollParse {
  const person = typeof b.person === "string" ? b.person.trim() : "";
  if (!person) return { ok: false, error: "Person is required" };

  const workDate = typeof b.workDate === "string" ? b.workDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { ok: false, error: "Work date must be YYYY-MM-DD" };

  // An absent basis means an older client that only ever sent shifts.
  const basis = (b.basis ?? "hour") as PayrollBasis;
  if (!BASES.includes(basis)) return { ok: false, error: "Basis must be hour, piece or package" };

  const rateCents = Math.trunc(Number(b.rateCents));
  if (!Number.isFinite(rateCents) || rateCents <= 0) return { ok: false, error: "Rate must be greater than zero" };

  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;

  let qty: number;
  let startTime: string | null = null;
  let endTime: string | null = null;

  if (basis === "hour") {
    startTime = typeof b.startTime === "string" ? b.startTime.trim() : "";
    endTime = typeof b.endTime === "string" ? b.endTime.trim() : "";
    const hours = shiftHours(startTime, endTime);
    if (hours == null) return { ok: false, error: "Start and end must be times like 20:00" };
    if (hours <= 0) return { ok: false, error: "Start and end time cannot be the same" };
    qty = hours;
  } else {
    const count = Number(b.qty);
    // A fractional count is a typo, not half a piece -- rejected, never rounded.
    if (!Number.isInteger(count) || count <= 0) {
      return { ok: false, error: `${basis === "piece" ? "Pieces" : "Packages"} must be a whole number greater than zero` };
    }
    qty = count;
  }

  return {
    ok: true,
    value: { person, workDate, basis, qty, startTime, endTime, rateCents,
             amountCents: payrollAmountCents(qty, rateCents), note },
  };
}
