"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { formatUSD } from "@/lib/money";
import type { ExpenseRow } from "@/lib/db/expenses";
import type { ExpenseItemRow } from "@/lib/db/expense-items";

type ItemDraft = { name: string; qty: string; unit: string };
const toDraft = (r: ExpenseItemRow): ItemDraft => ({
  name: r.name, qty: r.qty == null ? "" : String(r.qty), unit: r.unitCents == null ? "" : (r.unitCents / 100).toFixed(2),
});

export function ExpenseDetailEditor({ expense, initialItems }: { expense: ExpenseRow; initialItems: ExpenseItemRow[] }) {
  const [f, setF] = useState({
    description: expense.description, type: expense.type, category: expense.category ?? "",
    amount: (expense.amountCents / 100).toFixed(2), incurredOn: expense.incurredOn ?? "",
  });
  const [items, setItems] = useState<ItemDraft[]>([...initialItems.map(toDraft), { name: "", qty: "", unit: "" }]);

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => {
      const next = prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
      if (i === next.length - 1 && next[i].name.trim() !== "") next.push({ name: "", qty: "", unit: "" });
      return next;
    });
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const lineTotal = (it: ItemDraft) =>
    it.qty && it.unit ? formatUSD(Math.round(Number(it.qty) * Number(it.unit) * 100)) : "—";
  const pricedTotal = items.reduce((s, it) =>
    it.qty && it.unit ? s + Math.round(Number(it.qty) * Number(it.unit) * 100) : s, 0);

  const save = async () => {
    await fetch(`/api/expenses/${expense.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, amount: f.amount, incurredOn: f.incurredOn || null }),
    });
    await fetch(`/api/expenses/${expense.id}/items`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.filter((it) => it.name.trim() !== "").map((it) => ({ name: it.name, qty: it.qty || null, unit: it.unit || null })) }),
    });
    location.reload();
  };

  return (
    <div className="space-y-4">
      <Card title="Details">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Description
            <input className={`mt-1 w-full ${INPUT_CLASS}`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <label className="text-sm">Date
            <input type="date" className={`mt-1 w-full ${INPUT_CLASS}`} value={f.incurredOn} onChange={(e) => setF({ ...f, incurredOn: e.target.value })} /></label>
          <label className="text-sm">Type
            <select className={`mt-1 w-full ${INPUT_CLASS}`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ExpenseRow["type"] })}>
              <option value="one_time">One-time</option><option value="recurring">Recurring</option>
            </select></label>
          <label className="text-sm">Category
            <input className={`mt-1 w-full ${INPUT_CLASS}`} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></label>
          <label className="text-sm">Amount $
            <input className={`mt-1 w-full ${INPUT_CLASS}`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        </div>
      </Card>

      <Card title="Itemized details (reference only)">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr><th className="py-1 text-left">Item</th><th className="py-1 text-right">Qty</th>
              <th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Total</th><th /></tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-2"><input className={`w-full ${INPUT_CLASS}`} placeholder="Add item…" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} /></td>
                <td className="py-1 pr-2"><input className={`w-16 ${INPUT_CLASS} text-right`} value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></td>
                <td className="py-1 pr-2"><input className={`w-24 ${INPUT_CLASS} text-right`} value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} /></td>
                <td className="py-1 text-right text-slate-500">{lineTotal(it)}</td>
                <td className="py-1 pl-2 text-right">{i < items.length - 1 && (
                  <button onClick={() => removeItem(i)} className="text-slate-300 hover:text-red-600">×</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 border-t border-dashed border-line pt-2 text-xs text-slate-400">
          Items priced so far: {formatUSD(pricedTotal)} · Expense amount: {formatUSD(Math.round(Number(f.amount || 0) * 100))} <span className="text-slate-300">(they don't need to match)</span>
        </p>
      </Card>

      <Button onClick={save}>Save</Button>
    </div>
  );
}
