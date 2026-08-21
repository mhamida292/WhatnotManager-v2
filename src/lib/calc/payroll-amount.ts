/** Auto-calculated gross pay in cents: hours * rate, rounded. Returns 0 if either
 *  input is null/NaN (e.g. a flat entry with no hours — caller sets amount directly). */
export function payrollAmountCents(hours: number | null, rateCents: number | null): number {
  if (hours == null || rateCents == null) return 0;
  const h = Number(hours), r = Number(rateCents);
  if (!Number.isFinite(h) || !Number.isFinite(r)) return 0;
  return Math.round(h * r);
}
