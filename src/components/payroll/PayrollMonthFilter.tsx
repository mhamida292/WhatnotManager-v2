"use client";
import { useRouter, useSearchParams } from "next/navigation";

export function PayrollMonthFilter() {
  const router = useRouter();
  const params = useSearchParams();
  const month = params.get("month") ?? "";
  const set = (m: string) => router.push(m ? `/payroll?month=${m}` : "/payroll");
  return (
    <div className="flex items-center gap-2 text-sm">
      <input type="month" value={month} onChange={(e) => set(e.target.value)}
        className="rounded-xl border border-line bg-white px-3 py-2 text-sm" />
      {month && <button onClick={() => set("")} className="text-slate-500 hover:underline">All time</button>}
    </div>
  );
}
