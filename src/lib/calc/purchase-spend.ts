export interface SpendInvoice {
  invoiceDate: string | null;  // YYYY-MM-DD; undated invoices are ignored
  total: number;               // cents
}

export interface PeriodicSpend {
  thisMonthCents: number;
  thisMonthCount: number;
  lastMonthCents: number;
  lastMonthCount: number;
  lifetimeCents: number;
  lifetimeCount: number;
  monthsSpanned: number;       // first invoice month .. today, inclusive
  avgPerMonthCents: number;
  changePct: number | null;    // this month vs last; null when last month was 0
}

/** 'YYYY-MM-DD' -> months since year 0, so month arithmetic never touches Date
 *  and cannot drift with the timezone the server happens to run in. */
function monthIndex(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(ymd);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

/** Purchase spend by period, for the inventory cards. `today` is passed in
 *  rather than read from the clock so the result is testable. */
export function periodicSpend(invoices: SpendInvoice[], today: string): PeriodicSpend {
  const now = monthIndex(today);
  const dated = invoices
    .map((i) => ({ idx: i.invoiceDate ? monthIndex(i.invoiceDate) : null, total: i.total }))
    .filter((i): i is { idx: number; total: number } => i.idx != null);

  let thisMonthCents = 0, thisMonthCount = 0, lastMonthCents = 0, lastMonthCount = 0;
  let lifetimeCents = 0;
  let earliest: number | null = null;
  for (const i of dated) {
    lifetimeCents += i.total;
    if (earliest == null || i.idx < earliest) earliest = i.idx;
    if (now != null && i.idx === now) { thisMonthCents += i.total; thisMonthCount += 1; }
    if (now != null && i.idx === now - 1) { lastMonthCents += i.total; lastMonthCount += 1; }
  }

  // Span the calendar, not just the months that happen to have invoices: a
  // month you bought nothing in is a real month of not buying.
  const monthsSpanned = earliest == null || now == null ? 0 : Math.max(1, now - earliest + 1);
  const avgPerMonthCents = monthsSpanned === 0 ? 0 : Math.round(lifetimeCents / monthsSpanned);
  const changePct = lastMonthCents === 0
    ? null
    : Math.round(((thisMonthCents - lastMonthCents) / lastMonthCents) * 100);

  return {
    thisMonthCents, thisMonthCount, lastMonthCents, lastMonthCount,
    lifetimeCents, lifetimeCount: dated.length,
    monthsSpanned, avgPerMonthCents, changePct,
  };
}
