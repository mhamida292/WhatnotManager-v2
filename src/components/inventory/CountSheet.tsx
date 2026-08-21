"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";

type Item = { id: number; name: string; location?: string | null; expected: number };
const today = () => new Date().toISOString().slice(0, 10);

export function CountSheet({ items }: { items: Item[] }) {
  const router = useRouter();
  const [on, setOn] = useState(today());
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const diff = (it: Item) => counts[it.id]?.trim() ? Number(counts[it.id]) - it.expected : null;

  async function save() {
    const rows = items
      .filter((it) => counts[it.id]?.trim() !== undefined && counts[it.id]?.trim() !== "")
      .map((it) => ({ itemId: it.id, counted: Number(counts[it.id]), reason: reasons[it.id] || "recount" }));
    if (rows.some((r) => !Number.isInteger(r.counted) || r.counted < 0)) { setErr("Counts must be whole numbers (0 or more)."); return; }
    setErr(null); setSaving(true);
    try {
      const res = await fetch("/api/inventory/count", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on, rows }),
      });
      if (!res.ok) { setErr("Save failed."); return; }
      router.push("/inventory");
      router.refresh();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">Count date
          <input type="date" className={INPUT_CLASS} value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
        <Button onClick={save} disabled={saving}>Save count</Button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-center">Counted</th><th className="px-3 py-2 text-right">Diff</th>
              <th className="px-3 py-2">Reason (if off)</th></tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const d = diff(it);
              return (
                <tr key={it.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    {it.name}
                    <span className="ml-2 text-xs text-slate-400">{it.location ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{it.expected}</td>
                  <td className="px-3 py-2 text-center">
                    <input type="number" className={`w-20 text-center ${INPUT_CLASS}`} value={counts[it.id] ?? ""}
                      onChange={(e) => setCounts((c) => ({ ...c, [it.id]: e.target.value }))} placeholder="—" />
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${d == null ? "text-slate-300" : d === 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {d == null ? "—" : d === 0 ? "0 ✓" : d > 0 ? `+${d}` : d}
                  </td>
                  <td className="px-3 py-2">
                    {d != null && d !== 0 ? (
                      <select className={INPUT_CLASS} value={reasons[it.id] ?? "recount"} onChange={(e) => setReasons((r) => ({ ...r, [it.id]: e.target.value }))}>
                        <option value="recount">Recount</option><option value="sample">Sample</option>
                        <option value="damage_loss">Damage / Loss</option><option value="other">Other</option>
                      </select>
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
