"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { currentIsoWeek } from "@/lib/ui/expense-range";

type Mode = "week" | "month" | "all";

export function PeriodFilter() {
  const router = useRouter();
  const params = useSearchParams();
  const week = params.get("week") ?? "";
  const month = params.get("month") ?? "";
  const all = params.get("all");
  const mode: Mode = all ? "all" : month ? "month" : "week";

  const go = (qs: string) => router.push(qs ? `/expenses?${qs}` : "/expenses");
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
      {mode === "month" && (
        <input type="month" value={month || new Date().toISOString().slice(0, 7)} onChange={(e) => go(`month=${e.target.value}`)}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm" />
      )}
    </div>
  );
}
