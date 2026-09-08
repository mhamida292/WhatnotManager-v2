/** Auto-calculated gross pay in cents: hours * rate, rounded. Returns 0 if either
 *  input is null/NaN (e.g. a flat entry with no hours — caller sets amount directly). */
export function payrollAmountCents(hours: number | null, rateCents: number | null): number {
  if (hours == null || rateCents == null) return 0;
  const h = Number(hours), r = Number(rateCents);
  if (!Number.isFinite(h) || !Number.isFinite(r)) return 0;
  return Math.round(h * r);
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
