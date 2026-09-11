"use client";
import { useState } from "react";
import { Money } from "@/components/Money";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { shiftHours, payrollAmountCents } from "@/lib/calc/payroll-amount";
import { basisLabel, qtyLabel, workLabel } from "@/lib/ui/payroll-basis";
import type { PayrollBasis, PayrollRow } from "@/lib/db/payroll";

const BASIS_CLASS: Record<PayrollBasis, string> = {
  hour: "border-sky-200 bg-sky-50 text-sky-700",
  piece: "border-emerald-200 bg-emerald-50 text-emerald-700",
  package: "border-violet-200 bg-violet-50 text-violet-700",
};

export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ person: "", workDate: "", startTime: "", endTime: "", count: "", rate: "" });

  function startEdit(r: PayrollRow) {
    setEditing(r.id);
    setDraft({
      person: r.person, workDate: r.workDate,
      startTime: r.startTime ?? "", endTime: r.endTime ?? "",
      count: r.basis === "hour" ? "" : String(r.qty),
      rate: (r.rateCents / 100).toFixed(2),
    });
  }

  /** The quantity the draft would save, on the row's own basis. */
  function draftQty(r: PayrollRow): number | null {
    if (r.basis === "hour") return shiftHours(draft.startTime, draft.endTime);
    const n = Number(draft.count);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  async function save(r: PayrollRow) {
    const res = await fetch(`/api/payroll/${r.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person: draft.person, workDate: draft.workDate, basis: r.basis,
        startTime: draft.startTime, endTime: draft.endTime,
        qty: draft.count === "" ? null : Number(draft.count),
        rateCents: Math.round(Number(draft.rate) * 100), note: r.note,
      }),
    });
    if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
  }

  async function togglePaid(r: PayrollRow) {
    const paidOn = r.paidOn ? null : new Date().toISOString().slice(0, 10);
    const res = await fetch(`/api/payroll/${r.id}/paid`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paidOn }),
    });
    if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
  }

  async function del(id: number) {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/payroll/${id}`, { method: "DELETE" });
    location.reload();
  }

  if (rows.length === 0) return <p className="text-sm text-slate-400">No work logged in range.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead><tr className="text-left text-slate-500">
          <th className="py-2">Date</th><th>Person</th><th>Basis</th><th>Work</th>
          <th>Rate</th><th>Amount</th><th>Paid</th><th>Note</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => editing === r.id ? (
            <tr key={r.id} className="border-t border-line">
              <td className="py-2"><input type="date" className={INPUT_CLASS} value={draft.workDate} onChange={(e) => setDraft({ ...draft, workDate: e.target.value })} /></td>
              <td><input className={INPUT_CLASS} value={draft.person} onChange={(e) => setDraft({ ...draft, person: e.target.value })} /></td>
              <td className="text-slate-500">{basisLabel(r.basis)}</td>
              <td className="py-2">
                {r.basis === "hour" ? (
                  <span className="flex gap-1">
                    <input type="time" className={INPUT_CLASS} value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
                    <input type="time" className={INPUT_CLASS} value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
                  </span>
                ) : (
                  <input type="number" min="1" step="1" aria-label={qtyLabel(r.basis)} className={`w-24 ${INPUT_CLASS}`}
                    value={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.value })} />
                )}
              </td>
              <td><input className={`w-20 ${INPUT_CLASS}`} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /></td>
              <td><Money cents={payrollAmountCents(draftQty(r), Math.round(Number(draft.rate) * 100))} /></td>
              <td className="text-slate-400">—</td>
              <td>{r.note ?? "—"}</td>
              <td className="whitespace-nowrap">
                <button className="text-brand-600 hover:underline" onClick={() => save(r)}>Save</button>
                <button className="ml-2 text-slate-400 hover:text-slate-900" onClick={() => setEditing(null)}>Cancel</button>
              </td>
            </tr>
          ) : (
            <tr key={r.id} className="border-t border-line">
              <td className="py-2">{r.workDate}</td>
              <td>{r.person}</td>
              <td>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${BASIS_CLASS[r.basis]}`}>{r.basis}</span>
              </td>
              <td>
                {workLabel(r.basis, r.qty)}
                {r.basis === "hour" && r.startTime && (
                  <span className="ml-2 text-xs text-slate-400">{r.startTime}–{r.endTime}</span>
                )}
              </td>
              <td><Money cents={r.rateCents} /></td>
              <td><Money cents={r.amountCents} /></td>
              <td>
                <button onClick={() => togglePaid(r)}
                  title={r.paidOn ? "Click to mark unpaid" : "Click to mark paid today"}
                  className={r.paidOn ? "text-emerald-600 hover:underline" : "font-medium text-amber-600 hover:underline"}>
                  {r.paidOn ? `☑ ${r.paidOn}` : "☐ unpaid"}
                </button>
              </td>
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
