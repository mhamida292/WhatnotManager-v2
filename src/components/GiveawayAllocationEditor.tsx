"use client";
import { useEffect, useState } from "react";

interface Item { id: number; name: string; packCostCents: number; packQty: number; active: boolean; }
interface Row { giveawayItemId: number; count: number; }

export default function GiveawayAllocationEditor({
  showId, detectedCount,
}: { showId: number; detectedCount: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/shows/${showId}/giveaways`).then((r) => r.json()).then((d) => {
      setItems(d.items); setRows(d.allocations);
    });
  }, [showId]);

  const unitOf = (id: number) => {
    const it = items.find((i) => i.id === id);
    return it ? it.packCostCents / it.packQty : 0;
  };
  const allocatedCount = rows.reduce((s, r) => s + r.count, 0);
  const costCents = Math.round(rows.reduce((s, r) => s + r.count * unitOf(r.giveawayItemId), 0));

  function setRow(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setSaved(false);
  }
  function addRow() {
    if (items[0]) setRows([...rows, { giveawayItemId: items[0].id, count: 0 }]);
  }
  function removeRow(i: number) { setRows(rows.filter((_, idx) => idx !== i)); setSaved(false); }

  async function save() {
    await fetch(`/api/shows/${showId}/giveaways`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allocations: rows.filter((r) => r.count > 0) }),
    });
    setSaved(true);
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Giveaway Allocations</h3>
      <p className="text-sm text-slate-600">
        Ledger detected <strong>{detectedCount}</strong> giveaway{detectedCount === 1 ? "" : "s"} this show.
      </p>
      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-slate-500">
              <th className="py-1 pr-4 font-medium">Item</th>
              <th className="py-1 pr-4 font-medium">Count</th>
              <th className="py-1 pr-4 font-medium">Cost</th>
              <th className="py-1 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-2 pr-4">
                  <select
                    value={r.giveawayItemId}
                    onChange={(e) => setRow(i, { giveawayItemId: Number(e.target.value) })}
                    className="rounded border border-line bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    min={0}
                    value={r.count}
                    onChange={(e) => setRow(i, { count: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-20 rounded border border-line bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="py-2 pr-4 text-slate-600">
                  ${(r.count * unitOf(r.giveawayItemId) / 100).toFixed(2)}
                </td>
                <td className="py-2">
                  <button
                    onClick={() => removeRow(i)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex items-center gap-4">
        <button
          onClick={addRow}
          disabled={items.length === 0}
          className="text-sm font-medium text-blue-600 hover:underline disabled:opacity-50"
        >
          + Add item
        </button>
        <span className="text-sm text-slate-500">
          Allocated {allocatedCount} / {detectedCount} · Cost ${(costCents / 100).toFixed(2)}
        </span>
      </div>
      {allocatedCount !== detectedCount && (
        <p className="text-sm text-amber-700">⚠ Allocated {allocatedCount} doesn&apos;t match detected {detectedCount}.</p>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Save giveaways
        </button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
      </div>
    </section>
  );
}
