import { Money } from "@/components/Money";

export interface BreakdownInput {
  payoutCents: number;
  cogsCents: number;
  giveawayCostCents: number;
  laborCents: number;
  showProfitCents: number;
  expensesCents: number;
  businessProfitCents: number;
}

export interface BreakdownRow {
  label: string;
  amountCents: number;   // signed: deductions are negative
  widthPct: number;      // 0-100, proportional to payout
  color: string;
  strong?: boolean;
}

/** Bar widths for the breakdown, as a share of payout. Extracted from the
 *  component so the arithmetic is testable: a period with no payout must not
 *  divide by zero, and a negative profit must not render a backwards bar. */
export function breakdownRows(i: BreakdownInput): BreakdownRow[] {
  const pct = (c: number) =>
    i.payoutCents <= 0 ? 0 : Math.max(0, Math.min(100, (Math.abs(c) / i.payoutCents) * 100));

  return [
    { label: "Payout", amountCents: i.payoutCents, widthPct: pct(i.payoutCents), color: "bg-teal-700" },
    { label: "COGS", amountCents: -i.cogsCents, widthPct: pct(i.cogsCents), color: "bg-red-500" },
    { label: "Giveaways", amountCents: -i.giveawayCostCents, widthPct: pct(i.giveawayCostCents), color: "bg-orange-500" },
    { label: "Labor", amountCents: -i.laborCents, widthPct: pct(i.laborCents), color: "bg-violet-500" },
    { label: "Show profit", amountCents: i.showProfitCents, widthPct: pct(Math.max(i.showProfitCents, 0)), color: "bg-emerald-400" },
    { label: "Expenses", amountCents: -i.expensesCents, widthPct: pct(i.expensesCents), color: "bg-yellow-700" },
    { label: "Business profit", amountCents: i.businessProfitCents, widthPct: pct(Math.max(i.businessProfitCents, 0)), color: "bg-emerald-500", strong: true },
  ];
}

export function Breakdown(props: BreakdownInput) {
  const rows = breakdownRows(props);
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Breakdown</h2>
      <div className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[7.5rem_1fr_6.5rem] items-center gap-3 text-sm">
            <span className={r.strong ? "font-semibold" : "text-slate-600"}>{r.label}</span>
            <span className="h-3.5 rounded bg-slate-100">
              <span className={`block h-full rounded ${r.color}`} style={{ width: `${r.widthPct}%` }} />
            </span>
            <span className={`text-right tabular-nums ${r.strong ? "font-semibold" : ""}`}>
              <Money cents={r.amountCents} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
