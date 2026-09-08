"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { currentIsoWeek, periodHref, periodMode, periodLabel, shiftMonth, type Mode } from "@/lib/ui/expense-range";

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
        <input type="week" value={week || currentIsoWeek()} onChange={(e) => go(`week=${e.target.value}`)}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm" />
      )}
      {mode === "month" && (() => {
        // Stepper rather than a date input: months are almost always browsed one
        // at a time, and a bare `type="month"` renders as a text field to type
        // "2026-08" into. A specific month is still reachable via ?month=.
        const current = month || new Date().toISOString().slice(0, 7);
        const step = (delta: number) => (
          <button
            onClick={() => go(`month=${shiftMonth(current, delta)}`)}
            aria-label={delta < 0 ? "Previous month" : "Next month"}
            className="px-2.5 py-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >{delta < 0 ? "\u2039" : "\u203a"}</button>
        );
        return (
          <div className="inline-flex items-center overflow-hidden rounded-xl border border-line bg-white">
            {step(-1)}
            <span className="min-w-[8.5rem] px-1 text-center text-sm font-medium">{periodLabel({ month: current })}</span>
            {step(1)}
          </div>
        );
      })()}
    </div>
  );
}
