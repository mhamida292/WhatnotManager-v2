"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { payrollAmountCents, shiftHours } from "@/lib/calc/payroll-amount";

export function PayrollForm() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ person: "", workDate: today, startTime: "", endTime: "", rate: "", note: "" });
  const rateCents = f.rate === "" ? null : Math.round(Number(f.rate) * 100);
  // Hours come from the clock times now rather than being typed; null means a
  // time is missing or malformed, which payrollAmountCents reads as $0.
  const hours = shiftHours(f.startTime, f.endTime);
  const autoCents = payrollAmountCents(hours, rateCents);
  return (
    <Card title="Add payroll entry">
      <form className="space-y-2 text-sm max-w-sm" onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/payroll", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person: f.person, workDate: f.workDate,
            startTime: f.startTime, endTime: f.endTime,
            hours, rateCents, amountCents: autoCents, note: f.note || null }) });
        if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
      }}>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Person" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} required />
        <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.workDate} onChange={(e) => setF({ ...f, workDate: e.target.value })} required />
        <div className="flex gap-2">
          <input type="time" aria-label="Clock in" className={`w-full ${INPUT_CLASS}`} value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} required />
          <input type="time" aria-label="Clock out" className={`w-full ${INPUT_CLASS}`} value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} required />
        </div>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Rate $/hr" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        <p className="text-slate-500">
          {hours ?? 0} hour(s) · Amount: <span className="font-medium">${(autoCents / 100).toFixed(2)}</span>
        </p>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <Button type="submit">Add</Button>
      </form>
    </Card>
  );
}
