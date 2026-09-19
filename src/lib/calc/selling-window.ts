export interface SellingWindow {
  minutes: number | null;      // first sale -> last sale; null when under two sales
  unitsPerHour: number | null; // null when there is no window, or it is zero-length
}

/**
 * How long selling ran, from the ledger's SALE rows only.
 *
 * Sales, not all transactions: a refund or adjustment can land hours after the
 * stream ended, which stretches an all-transaction span to 22h on real data.
 *
 * This is a LOWER BOUND on stream length -- Whatnot's ledger records no start
 * or stop event, so time before the first sale and after the last is invisible.
 *
 * Both figures are differences between timestamps, so they hold whatever
 * timezone the ledger is written in.
 */
export function sellingWindow(saleTimesSeconds: number[], unitsSold: number): SellingWindow {
  if (saleTimesSeconds.length < 2) return { minutes: null, unitsPerHour: null };
  const sorted = [...saleTimesSeconds].sort((a, b) => a - b);
  const minutes = Math.round((sorted[sorted.length - 1] - sorted[0]) / 60);
  return {
    minutes,
    // Sales inside one minute give a zero-length window; a rate would divide by zero.
    unitsPerHour: minutes === 0 ? null : Math.round((unitsSold / minutes) * 60),
  };
}

/** Minutes as "55m" / "1h 27m". */
export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  return h === 0 ? `${mins}m` : `${h}h ${mins % 60}m`;
}
