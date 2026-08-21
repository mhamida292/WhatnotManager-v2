"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function ExpenseForm() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ description: "", type: "one_time", category: "", amount: "", incurredOn: today, paidBy: "", reimbursable: false });
  return (
    <div>
      <form className="space-y-2 text-sm max-w-sm" onSubmit={async (e) => {
        e.preventDefault();
        await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: f.description, type: f.type, category: f.category,
            amountCents: Math.round(Number(f.amount) * 100), incurredOn: f.incurredOn || null,
            paidBy: f.paidBy.trim() || null, reimbursable: f.reimbursable }) });
        location.reload();
      }}>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <select className={`w-full ${INPUT_CLASS}`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="one_time">One-time</option><option value="recurring">Recurring</option>
        </select>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Amount $" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.incurredOn} onChange={(e) => setF({ ...f, incurredOn: e.target.value })} />
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Paid by (name)" value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value })} />
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" checked={f.reimbursable} onChange={(e) => setF({ ...f, reimbursable: e.target.checked })} />
          Reimbursable (someone fronted it)
        </label>
        <Button type="submit">Add</Button>
      </form>
    </div>
  );
}
