import type { DateRange } from "@/lib/db/expenses";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** ISO-8601 week (Mon–Sun) for `YYYY-Www`; undefined if malformed or out of range. */
export function weekRange(isoWeek: string): DateRange | undefined {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!m) return undefined;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return undefined;
  // Monday of ISO week 1 = the Monday on/before Jan 4.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Dow + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

/** ISO week string (YYYY-Www) for a date (default now). */
export function currentIsoWeek(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dow + 3); // Thursday of this week
  const year = date.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.floor((date.getTime() - jan1.getTime()) / 86400000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** Human label for the active period, for the Total card. */
export function periodLabel(p: { week?: string; month?: string; all?: string }): string {
  if (p.all) return "all time";
  if (p.week) return "this week";
  if (p.month && /^\d{4}-\d{2}$/.test(p.month)) {
    const [y, m] = p.month.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  return "this week";
}

/** Build a DateRange from URL search params.
 *  Precedence: all → (from/to) → week → month → undefined (all time).
 *  A malformed week falls through to month. */
export function rangeFromParams(p: { month?: string; from?: string; to?: string; week?: string; all?: string }): DateRange | undefined {
  if (p.all) return undefined;
  if (p.from || p.to) return { from: p.from, to: p.to };
  if (p.week) {
    const r = weekRange(p.week);
    if (r) return r;
  }
  if (p.month && /^\d{4}-\d{2}$/.test(p.month)) {
    const [y, m] = p.month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${p.month}-01`, to: `${p.month}-${String(last).padStart(2, "0")}` };
  }
  return undefined;
}

export type Mode = "week" | "month" | "all";

/** Build a period URL for any page. Kept out of the component so the rule is
 *  testable without rendering React and a router. */
export function periodHref(basePath: string, query: string): string {
  return query ? `${basePath}?${query}` : basePath;
}

/** Resolve the active period mode from URL search params and a fallback.
 *  Precedence: all → month → week → fallback. */
export function periodMode(p: { week?: string; month?: string; all?: string }, fallback: Mode): Mode {
  if (p.all) return "all";
  if (p.month) return "month";
  if (p.week) return "week";
  return fallback;
}
