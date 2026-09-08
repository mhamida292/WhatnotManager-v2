"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { shiftHours, payrollAmountCents } from "@/lib/calc/payroll-amount";

export function PayrollForm() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ person: "", workDate: today, startTime: "", endTime: "", rate: "", note: "" });
  const [error, setError] = useState<string | null>(null);

  const rateCents = f.rate === "" ? null : Math.round(Number(f.rate) * 100);
  const hours = f.startTime && f.endTime ? shiftHours(f.startTime, f.endTime) : null;
  const amountCents = hours != null && rateCents != null ? payrollAmountCents(hours, rateCents) : 0;
  const ready = !!f.person.trim() && hours != null && hours > 0 && !!rateCents && rateCents > 0;

  return (
    <Card title="Log a shift">
      <form className="max-w-sm space-y-2 text-sm" onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const res = await fetch("/api/payroll", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person: f.person, workDate: f.workDate, startTime: f.startTime,
            endTime: f.endTime, rateCents, note: f.note || null,
          }),
        });
        if (res.ok) location.reload();
        else setError((await res.json()).error ?? "Could not save");
      }}>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Person" value={f.person}
          onChange={(e) => setF({ ...f, person: e.target.value })} required />
        <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.workDate}
          onChange={(e) => setF({ ...f, workDate: e.target.value })} required />
        <div className="flex gap-2">
          <input type="time" aria-label="Start time" className={`w-full ${INPUT_CLASS}`} value={f.startTime}
            onChange={(e) => setF({ ...f, startTime: e.target.value })} required />
          <input type="time" aria-label="End time" className={`w-full ${INPUT_CLASS}`} value={f.endTime}
            onChange={(e) => setF({ ...f, endTime: e.target.value })} required />
        </div>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Rate $/hr" value={f.rate}
          onChange={(e) => setF({ ...f, rate: e.target.value })} required />
        <p className="text-slate-500">
          Hours: <span className="font-medium">{hours == null ? "—" : hours.toFixed(2)}</span>
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
