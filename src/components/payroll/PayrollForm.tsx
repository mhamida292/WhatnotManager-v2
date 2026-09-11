"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { shiftHours, payrollAmountCents } from "@/lib/calc/payroll-amount";
import { PAYROLL_BASES, basisLabel, qtyLabel, rateLabel } from "@/lib/ui/payroll-basis";
import type { PayrollBasis } from "@/lib/db/payroll";
import type { PayrollRate } from "@/lib/db/payroll-rates";

export function PayrollForm({ rates }: { rates: PayrollRate[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [basis, setBasis] = useState<PayrollBasis>("hour");
  const [f, setF] = useState({ person: "", workDate: today, startTime: "", endTime: "", count: "", rate: "", note: "" });
  const [error, setError] = useState<string | null>(null);

  /** The saved default for a person on a basis, as a form-shaped string. */
  function savedRate(person: string, b: PayrollBasis): string {
    const hit = rates.find((r) => r.person === person.trim() && r.basis === b);
    return hit ? (hit.rateCents / 100).toFixed(2) : "";
  }

  // Changing either the person or the basis re-fills the rate, but only while
  // the field still holds a default -- never over a rate typed by hand.
  function pickPerson(person: string) {
    const wasDefault = f.rate === "" || f.rate === savedRate(f.person, basis);
    setF({ ...f, person, rate: wasDefault ? savedRate(person, basis) : f.rate });
  }
  function pickBasis(b: PayrollBasis) {
    const wasDefault = f.rate === "" || f.rate === savedRate(f.person, basis);
    if (wasDefault) setF({ ...f, rate: savedRate(f.person, b) });
    setBasis(b);
  }

  const rateCents = f.rate === "" ? null : Math.round(Number(f.rate) * 100);
  const count = f.count === "" ? null : Number(f.count);
  const qty = basis === "hour"
    ? (f.startTime && f.endTime ? shiftHours(f.startTime, f.endTime) : null)
    : (count != null && Number.isInteger(count) && count > 0 ? count : null);
  const amountCents = qty != null && rateCents != null ? payrollAmountCents(qty, rateCents) : 0;
  const ready = !!f.person.trim() && qty != null && qty > 0 && !!rateCents && rateCents > 0;

  return (
    <Card title="Log work">
      <form className="max-w-sm space-y-2 text-sm" onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const res = await fetch("/api/payroll", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person: f.person, workDate: f.workDate, basis,
            startTime: f.startTime, endTime: f.endTime, qty: count,
            rateCents, note: f.note || null,
          }),
        });
        if (res.ok) location.reload();
        else setError((await res.json()).error ?? "Could not save");
      }}>
        <div className="flex rounded-xl border border-line p-0.5">
          {PAYROLL_BASES.map((b) => (
            <button key={b} type="button" onClick={() => pickBasis(b)}
              className={`flex-1 rounded-lg px-3 py-1.5 ${b === basis ? "bg-brand-600 font-medium text-white" : "text-slate-500 hover:text-slate-900"}`}>
              {basisLabel(b)}
            </button>
          ))}
        </div>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Person" value={f.person}
          onChange={(e) => pickPerson(e.target.value)} required />
        <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.workDate}
          onChange={(e) => setF({ ...f, workDate: e.target.value })} required />
        {basis === "hour" ? (
          <div className="flex gap-2">
            <input type="time" aria-label="Start time" className={`w-full ${INPUT_CLASS}`} value={f.startTime}
              onChange={(e) => setF({ ...f, startTime: e.target.value })} required />
            <input type="time" aria-label="End time" className={`w-full ${INPUT_CLASS}`} value={f.endTime}
              onChange={(e) => setF({ ...f, endTime: e.target.value })} required />
          </div>
        ) : (
          <input type="number" min="1" step="1" aria-label={qtyLabel(basis)}
            className={`w-full ${INPUT_CLASS}`} placeholder={qtyLabel(basis)} value={f.count}
            onChange={(e) => setF({ ...f, count: e.target.value })} required />
        )}
        <input className={`w-full ${INPUT_CLASS}`} placeholder={`Rate ${rateLabel(basis)}`} value={f.rate}
          onChange={(e) => setF({ ...f, rate: e.target.value })} required />
        <p className="text-slate-500">
          {qtyLabel(basis)}: <span className="font-medium">{qty == null ? "—" : basis === "hour" ? qty.toFixed(2) : qty}</span>
          {" · "}Amount: <span className="font-medium">${(amountCents / 100).toFixed(2)}</span>
        </p>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Note" value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })} />
        {error && <p className="text-red-600">{error}</p>}
        <Button type="submit" disabled={!ready}>Add</Button>
      </form>
    </Card>
  );
}
