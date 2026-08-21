/** A new show (session) begins when the gap to the previous transaction exceeds this. */
export const SESSION_GAP_MINUTES = 60;

/**
 * Assign a 0-based session index to each transaction time.
 * `timesInSeconds` MUST be sorted ascending (the caller sorts by time-of-day).
 * A new session starts whenever the gap from the previous time is strictly
 * greater than `gapSeconds` (exactly equal stays in the same session).
 */
export function sessionizeByGap(timesInSeconds: number[], gapSeconds: number): number[] {
  const out: number[] = [];
  let session = 0;
  for (let i = 0; i < timesInSeconds.length; i++) {
    if (i > 0 && timesInSeconds[i] - timesInSeconds[i - 1] > gapSeconds) session++;
    out.push(session);
  }
  return out;
}

/**
 * Session index for EVERY item, with boundaries driven by sales only.
 * Sales define sessions via sessionizeByGap; each session gets a [min,max] sale-time
 * window; every item (sale or not) is assigned to the window containing its time, or
 * the nearest window (ties -> earlier session). No sales -> all 0 (single session).
 */
export function assignSessions(
  items: { timeSeconds: number; isSale: boolean }[],
  gapSeconds: number
): number[] {
  const saleTimes = items.filter((i) => i.isSale).map((i) => i.timeSeconds).sort((a, b) => a - b);
  if (saleTimes.length === 0) return items.map(() => 0);
  const saleSeq = sessionizeByGap(saleTimes, gapSeconds);
  const windows: { start: number; end: number }[] = [];
  for (let i = 0; i < saleTimes.length; i++) {
    const s = saleSeq[i];
    if (!windows[s]) windows[s] = { start: saleTimes[i], end: saleTimes[i] };
    else windows[s].end = saleTimes[i]; // saleTimes sorted ascending, so end only grows
  }
  return items.map((it) => nearestWindowIndex(it.timeSeconds, windows));
}

function nearestWindowIndex(t: number, windows: { start: number; end: number }[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const dist = t < w.start ? w.start - t : t > w.end ? t - w.end : 0;
    if (dist < bestDist) { bestDist = dist; best = i; } // strict < keeps the earlier session on ties
  }
  return best;
}

/** Seconds-of-day -> "h:mm AM/PM" (e.g. 0 -> "12:00 AM", 43200 -> "12:00 PM"). */
export function secondsToClock(sec: number): string {
  const h24 = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
