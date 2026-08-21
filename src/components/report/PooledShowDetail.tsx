import { Money } from "@/components/Money";
import type { ReportShow } from "@/lib/calc/ledger-report";

export function PooledShowDetail({ show }: { show: ReportShow }) {
  const sales = show.pooledSales ?? [];
  return (
    <div className="text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-700">
        <span>Pool COGS <b><Money cents={show.cogsCents} /></b></span>
      </div>
      {sales.length > 0 && (
        <details className="mt-2 rounded-lg border border-line bg-white">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-600">
            {sales.length} individual sale{sales.length === 1 ? "" : "s"}
          </summary>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-t border-line text-slate-500">
                <th className="px-3 py-1.5">Sold at</th>
                <th className="px-3 py-1.5 text-right">Amount</th>
                <th className="px-3 py-1.5 text-right">Pool cost</th>
                <th className="px-3 py-1.5 text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-1.5">{s.createdAt}</td>
                  <td className="px-3 py-1.5 text-right"><Money cents={s.amountCents} /></td>
                  <td className="px-3 py-1.5 text-right"><Money cents={s.costCents} /></td>
                  <td className="px-3 py-1.5 text-right"><Money cents={s.amountCents - s.costCents} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
