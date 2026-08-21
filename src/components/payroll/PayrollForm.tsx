"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { payrollAmountCents } from "@/lib/calc/payroll-amount";

export function PayrollForm() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ person: "", periodStart: today, periodEnd: today, hours: "", rate: "", note: "" });
  const rateCents = f.rate === "" ? null : Math.round(Number(f.rate) * 100);
  const hours = f.hours === "" ? null : Number(f.hours);
  const autoCents = payrollAmountCents(hours, rateCents);
  return (
    <Card title="Add payroll entry">
      <form className="space-y-2 text-sm max-w-sm" onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/payroll", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person: f.person, periodStart: f.periodStart || null, periodEnd: f.periodEnd || null,
            hours, rateCents, amountCents: autoCents, note: f.note || null }) });
        if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
      }}>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Person" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} required />
        <div className="flex gap-2">
          <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} />
          <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <input className={`w-full ${INPUT_CLASS}`} placeholder="Hours" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          <input className={`w-full ${INPUT_CLASS}`} placeholder="Rate $/hr" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
        </div>
        <p className="text-slate-500">Amount: <span className="font-medium">${(autoCents / 100).toFixed(2)}</span></p>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <Button type="submit">Add</Button>
      </form>
    </Card>
  );
}
