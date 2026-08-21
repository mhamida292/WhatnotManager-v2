"use client";
import { useState } from "react";
import Link from "next/link";
import { Money } from "@/components/Money";
import { DataTable } from "@/components/ui/DataTable";
import type { ExpenseRow } from "@/lib/db/expenses";

type Key = "incurredOn" | "description" | "category" | "amountCents";

export function ExpensesTable({ rows }: { rows: ExpenseRow[] }) {
  const [key, setKey] = useState<Key>("incurredOn");
  const [asc, setAsc] = useState(false);
  const sorted = [...rows].sort((a, b) => {
    const av = a[key] ?? "", bv = b[key] ?? "";
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return asc ? cmp : -cmp;
  });
  const toggle = (k: Key) => { if (k === key) setAsc(!asc); else { setKey(k); setAsc(false); } };
  const arrow = (k: Key) => (k === key ? (asc ? " ▲" : " ▼") : "");
  const del = async (id: number) => {
    if (!confirm("Delete this expense?")) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    location.reload();
  };
  const toggleReimbursed = async (id: number, on: string | null) => {
    await fetch(`/api/expenses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reimbursedOn: on }) });
    location.reload();
  };
  const H = ({ k, label, right }: { k: Key; label: string; right?: boolean }) => (
    <th className={`cursor-pointer px-3 py-2 ${right ? "text-right" : ""}`} onClick={() => toggle(k)}>{label}{arrow(k)}</th>
  );
  return (
    <DataTable head={<>
      <H k="incurredOn" label="Date" /><H k="description" label="Description" />
      <H k="category" label="Category" />
      <th className="px-3 py-2">Paid by</th>
      <H k="amountCents" label="Amount" right />
      <th className="px-3 py-2">Reimbursed</th>
      <th className="px-3 py-2" />
    </>}>
      {sorted.length === 0 && (
        <tr className="border-t border-line"><td className="px-3 py-4 text-slate-400" colSpan={7}>No expenses yet.</td></tr>
      )}
      {sorted.map((e) => (
        <tr key={e.id} className="border-t border-line hover:bg-slate-50">
          <td className="px-3 py-2 text-slate-500">{e.incurredOn ?? "—"}</td>
          <td className="px-3 py-2">
            <Link href={`/expenses/${e.id}`} className="text-brand-700 hover:underline">{e.description} ›</Link>
          </td>
          <td className="px-3 py-2">{e.category ?? "—"}</td>
          <td className="px-3 py-2">{e.paidBy ?? "—"}</td>
          <td className="px-3 py-2 text-right"><Money cents={e.amountCents} /></td>
          <td className="px-3 py-2">
            {e.reimbursable ? (
              e.reimbursedOn
                ? <button className="text-emerald-600 hover:underline" onClick={() => toggleReimbursed(e.id, null)}>Reimbursed ✓</button>
                : <button className="text-amber-600 hover:underline" onClick={() => toggleReimbursed(e.id, new Date().toISOString().slice(0, 10))}>Mark reimbursed</button>
            ) : <span className="text-slate-400">—</span>}
          </td>
          <td className="px-3 py-2 text-right">
            <button onClick={() => del(e.id)} className="text-slate-400 hover:text-red-600" title="Delete">🗑</button>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
