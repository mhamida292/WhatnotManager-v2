"use client";
import { Money } from "@/components/Money";
import type { PayrollRow } from "@/lib/db/payroll";

export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  async function del(id: number) {
    if (!confirm("Delete this payroll entry?")) return;
    await fetch(`/api/payroll/${id}`, { method: "DELETE" });
    location.reload();
  }
  if (rows.length === 0) return <p className="text-sm text-slate-400">No payroll entries in range.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-slate-500">
        <th className="py-2">Period</th><th>Person</th><th>Hours</th><th>Rate</th><th>Amount</th><th>Note</th><th></th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-line">
            <td className="py-2">{r.periodStart ?? "—"}{r.periodEnd ? ` → ${r.periodEnd}` : ""}</td>
            <td>{r.person}</td>
            <td>{r.hours ?? "—"}</td>
            <td>{r.rateCents == null ? "—" : <Money cents={r.rateCents} />}</td>
            <td><Money cents={r.amountCents} /></td>
            <td>{r.note ?? "—"}</td>
            <td><button className="text-slate-400 hover:text-red-600" onClick={() => del(r.id)}>Delete</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
