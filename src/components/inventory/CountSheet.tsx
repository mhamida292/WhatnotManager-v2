"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { rowLabel, matchesSearch, sortCountRows, countDiff, type CountItem, type NameMode, type CountSort } from "@/lib/calc/count-sheet";

const today = () => new Date().toISOString().slice(0, 10);

export function CountSheet({ items }: { items: CountItem[] }) {
  const router = useRouter();
  const [on, setOn] = useState(today());
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<NameMode>("whatnot");
  const [sort, setSort] = useState<CountSort>("name");
  const [query, setQuery] = useState("");

  // Rows hidden by the search keep their counts and are still saved.
  const shown = useMemo(
    () => sortCountRows(items.filter((it) => matchesSearch(it, query)), mode, sort, counts),
    [items, query, mode, sort, counts]);
  const countedRows = items.filter((it) => counts[it.id]?.trim()).length;

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
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">Count date
          <input type="date" className={INPUT_CLASS} value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Search
          <input type="search" className={INPUT_CLASS} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, SKU or Whatnot name" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Show names as
          <select className={INPUT_CLASS} value={mode} onChange={(e) => setMode(e.target.value as NameMode)}>
            <option value="whatnot">Whatnot</option><option value="name">Item name</option><option value="sku">SKU</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Sort
          <select className={INPUT_CLASS} value={sort} onChange={(e) => setSort(e.target.value as CountSort)}>
            <option value="name">Name A–Z</option><option value="expected-desc">Expected, high to low</option>
            <option value="expected-asc">Expected, low to high</option><option value="off-first">Off first</option>
          </select>
        </label>
        <Button onClick={save} disabled={saving || countedRows === 0}>
          {countedRows === 0 ? "Save count" : `Save ${countedRows} count${countedRows === 1 ? "" : "s"}`}
        </Button>
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
            {shown.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">No items match “{query.trim()}”.</td></tr>
            )}
            {shown.map((it) => {
              const d = countDiff(it, counts[it.id]);
              const label = rowLabel(it, mode);
              return (
                <tr key={it.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <span className={label.fallback ? "text-slate-400" : undefined}>{label.text}</span>
                    {label.others.length > 0 && (
                      <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500" title={label.others.join("\n")}>
                        +{label.others.length}
                      </span>
                    )}
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
