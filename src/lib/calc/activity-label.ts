export interface ActivityRow { kind: string; message: string }

/** Whatnot says what a row is only in its message, and 'other' is a grab bag,
 *  so the name comes from the message first and the kind as a fallback. */
function nameOne(r: ActivityRow): string {
  const m = r.message ?? "";
  if (/shipping costs/i.test(m)) return "return shipping";
  if (/insurance claim/i.test(m)) return "insurance claim";
  if (/Show Boost|Show Promotion/i.test(m)) return "promotion";
  if (/shipping adjustment/i.test(m)) return "shipping adjustment";
  if (/cancellation/i.test(m)) return "cancellation fee";
  switch (r.kind) {
    case "refund": return "refund";
    case "payout": return "bank payout";
    case "tip": return "tip";
    case "bonus": return "bonus";
    case "giveaway": return "giveaway fee";
    case "sale": return "sale";
    default: return "adjustment";
  }
}

const PLURALS: Record<string, string> = {
  "return shipping": "return shipping",
  "insurance claim": "insurance claims",
  promotion: "promotions",
  "shipping adjustment": "shipping adjustments",
  "cancellation fee": "cancellation fees",
  refund: "refunds",
  "bank payout": "bank payouts",
  tip: "tips",
  bonus: "bonuses",
  "giveaway fee": "giveaway fees",
  sale: "sales",
  adjustment: "adjustments",
};

/** What happened on a day, in words: "2 refunds · return shipping".
 *  Most numerous first, so the headline of the day leads. */
export function describeActivity(rows: ActivityRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const n = nameOne(r);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  if (counts.size === 0) return "";
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n === 1 ? name : `${n} ${PLURALS[name] ?? name + "s"}`));
  // Only the first word is capitalised: the rest read as a continuing list.
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + (parts.length > 1 ? ` · ${parts.slice(1).join(" · ")}` : "");
}
