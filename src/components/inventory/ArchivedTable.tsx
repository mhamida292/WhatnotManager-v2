"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BulkActionBar, type BulkAction } from "@/components/inventory/BulkActionBar";
import { bulkDeleteMessage } from "@/lib/ui/bulk-delete-message";

type Row = { id: number; name: string; remaining: number; archivedAt: string | null };

export function ArchivedTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clear = () => setSelected(new Set());
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const [bulkBusy, setBulkBusy] = useState(false);
  async function runBulk(action: "unarchive" | "delete") {
    if (bulkBusy) return;
    const ids = [...selected];
    setBulkBusy(true);
    try {
      if (action === "delete") {
        const res = await fetch("/api/inventory/bulk-delete-impact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
        if (!res.ok) return;
        if (!confirm(bulkDeleteMessage(await res.json()))) return;
      }
      const r = await fetch("/api/inventory/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids }) });
      if (r.ok) { clear(); router.refresh(); }
    } catch { /* network error */
    } finally { setBulkBusy(false); }
  }

  const actions: BulkAction[] = [
    { label: "Unarchive", variant: "primary", onClick: () => runBulk("unarchive") },
    { label: "Delete", variant: "danger", onClick: () => runBulk("delete") },
  ];

  return (
    <details className="rounded-2xl border border-line bg-white shadow-soft">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-500">Archived ({rows.length})</summary>
      <div className="space-y-2 border-t border-line p-3">
        <BulkActionBar count={selected.size} actions={actions} onClear={clear} busy={bulkBusy} />
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all archived" /></th>
              <th className="px-2 py-1">Item</th><th className="px-2 py-1 text-right">Remaining</th><th className="px-2 py-1">Archived</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-line ${selected.has(r.id) ? "bg-brand-50" : ""}`}>
                <td className="px-2 py-2"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
                <td className="px-2 py-2"><Link href={`/inventory/${r.id}`} className="font-medium text-slate-600 hover:underline">{r.name}</Link></td>
                <td className="px-2 py-2 text-right text-slate-400">{r.remaining}</td>
                <td className="px-2 py-2 text-xs text-slate-400">{r.archivedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
