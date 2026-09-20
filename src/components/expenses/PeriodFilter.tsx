"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { currentIsoWeek, periodHref, periodMode, periodLabel, shiftMonth, shiftWeek, weekLabel, type Mode } from "@/lib/ui/expense-range";

/** Arrows either side of the active period. A stepper rather than a date input
 *  because periods are browsed one at a time, and `type="week"`/`type="month"`
 *  render as a field you must type "2026-W38" into. A specific period is still
 *  reachable via ?week= / ?month=. */
function Stepper({ label, onStep, unit }: { label: string; onStep: (delta: number) => void; unit: string }) {
  const arrow = (delta: number) => (
    <button
      onClick={() => onStep(delta)}
      aria-label={`${delta < 0 ? "Previous" : "Next"} ${unit}`}
      className="px-2.5 py-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
    >{delta < 0 ? "\u2039" : "\u203a"}</button>
  );
  return (
    <div className="inline-flex items-center overflow-hidden rounded-xl border border-line bg-white">
      {arrow(-1)}
      <span className="min-w-[8.5rem] px-1 text-center text-sm font-medium">{label}</span>
      {arrow(1)}
    </div>
  );
}

export function PeriodFilter({ basePath = "/expenses", defaultMode = "week" }: { basePath?: string; defaultMode?: Mode } = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const week = params.get("week") ?? "";
  const month = params.get("month") ?? "";
  const all = params.get("all");
  const mode: Mode = periodMode({ week: week || undefined, month: month || undefined, all: all || undefined }, defaultMode);

  const go = (qs: string) => router.push(periodHref(basePath, qs));
  const pickMode = (m: Mode) => {
    if (m === "all") go("all=1");
    else if (m === "month") go(`month=${month || new Date().toISOString().slice(0, 7)}`);
    else go(`week=${week || currentIsoWeek()}`);
  };

  const seg = (m: Mode, label: string) => (
    <button
      onClick={() => pickMode(m)}
      className={`px-3 py-1.5 text-sm ${mode === m ? "bg-brand-600 font-semibold text-white" : "text-slate-600 hover:bg-slate-50"}`}
    >{label}</button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div className="inline-flex overflow-hidden rounded-xl border border-line bg-white">
        {seg("week", "Week")}{seg("month", "Month")}{seg("all", "All time")}
      </div>
      {mode === "week" && (
        <Stepper
          label={weekLabel(week || currentIsoWeek())}
          onStep={(d) => go(`week=${shiftWeek(week || currentIsoWeek(), d)}`)}
          unit="week"
        />
      )}
      {mode === "month" && (
        <Stepper
          label={periodLabel({ month: month || new Date().toISOString().slice(0, 7) })}
          onStep={(d) => go(`month=${shiftMonth(month || new Date().toISOString().slice(0, 7), d)}`)}
          unit="month"
        />
      )}
    </div>
  );
}
