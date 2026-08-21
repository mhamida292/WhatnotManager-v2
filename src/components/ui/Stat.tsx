import { ReactNode } from "react";

export function Stat({ label, value, sub }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-soft">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
