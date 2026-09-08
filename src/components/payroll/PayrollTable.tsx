"use client";
import { useState } from "react";
import { Money } from "@/components/Money";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { shiftHours, payrollAmountCents } from "@/lib/calc/payroll-amount";
import type { PayrollRow } from "@/lib/db/payroll";

export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ person: "", workDate: "", startTime: "", endTime: "", rate: "" });

  function startEdit(r: PayrollRow) {
    setEditing(r.id);
    setDraft({ person: r.person, workDate: r.workDate, startTime: r.startTime, endTime: r.endTime, rate: (r.rateCents / 100).toFixed(2) });
  }

  async function save(id: number) {
    const res = await fetch(`/api/payroll/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, rateCents: Math.round(Number(draft.rate) * 100), note: null }),
    });
    if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
  }

  async function del(id: number) {
    if (!confirm("Delete this shift?")) return;
    await fetch(`/api/payroll/${id}`, { method: "DELETE" });
    location.reload();
  }

  if (rows.length === 0) return <p className="text-sm text-slate-400">No shifts in range.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead><tr className="text-left text-slate-500">
          <th className="py-2">Date</th><th>Person</th><th>Shift</th><th>Hours</th><th>Rate</th><th>Amount</th><th>Note</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => editing === r.id ? (
            <tr key={r.id} className="border-t border-line">
              <td className="py-2"><input type="date" className={INPUT_CLASS} value={draft.workDate} onChange={(e) => setDraft({ ...draft, workDate: e.target.value })} /></td>
              <td><input className={INPUT_CLASS} value={draft.person} onChange={(e) => setDraft({ ...draft, person: e.target.value })} /></td>
              <td className="flex gap-1 py-2">
                <input type="time" className={INPUT_CLASS} value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
                <input type="time" className={INPUT_CLASS} value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
              </td>
              <td>{(shiftHours(draft.startTime, draft.endTime) ?? 0).toFixed(2)}</td>
              <td><input className={`w-20 ${INPUT_CLASS}`} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /></td>
              <td><Money cents={payrollAmountCents(shiftHours(draft.startTime, draft.endTime), Math.round(Number(draft.rate) * 100))} /></td>
              <td>{r.note ?? "—"}</td>
              <td className="whitespace-nowrap">
                <button className="text-brand-600 hover:underline" onClick={() => save(r.id)}>Save</button>
                <button className="ml-2 text-slate-400 hover:text-slate-900" onClick={() => setEditing(null)}>Cancel</button>
              </td>
            </tr>
          ) : (
            <tr key={r.id} className="border-t border-line">
              <td className="py-2">{r.workDate}</td>
              <td>{r.person}</td>
              <td>{r.startTime}–{r.endTime}</td>
              <td>{r.hours.toFixed(2)}</td>
              <td><Money cents={r.rateCents} /></td>
              <td><Money cents={r.amountCents} /></td>
              <td>{r.note ?? "—"}</td>
              <td className="whitespace-nowrap">
                <button className="text-slate-400 hover:text-slate-900" onClick={() => startEdit(r)}>Edit</button>
                <button className="ml-2 text-slate-400 hover:text-red-600" onClick={() => del(r.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
