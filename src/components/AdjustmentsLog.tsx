"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import type { Adjustment } from "@/lib/db/adjustments";

const REASON_LABELS: Record<string, string> = {
  sample: "Sample",
  damage_loss: "Damage / Loss",
  recount: "Recount",
  other: "Other",
};

const today = () => new Date().toISOString().slice(0, 10);

export function AdjustmentsLog({ itemId, initial, whatnotOnly }: { itemId: number; initial: Adjustment[]; whatnotOnly?: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Adjustment[]>(initial);

  // Fetch on mount when initial is empty (e.g. called from EditItemModal)
  useEffect(() => {
    if (initial.length === 0) {
      fetch(`/api/inventory/${itemId}/adjustments`)
        .then((r) => r.json())
        .then((data: Adjustment[]) => setRows(data))
        .catch(() => {/* ignore */});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // Add form state
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState<string>("sample");
  const [channel, setChannel] = useState<string>("warehouse");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [qtyError, setQtyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    const qtyNum = Number(qty);
    if (!Number.isInteger(qtyNum) || qtyNum === 0) {
      setQtyError("Qty must be a non-zero whole number (negative is allowed).");
      return;
    }
    setQtyError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${itemId}/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustedOn: date || null, reason, qty: qtyNum, note: note.trim() || null, channel: whatnotOnly ? "whatnot" : channel }),
      });
      if (!res.ok) { setSaving(false); return; }
      const { id } = await res.json();
      const newRow: Adjustment = {
        id, itemId,
        adjustedOn: date || null,
        reason: reason as Adjustment["reason"],
        qty: qtyNum,
        note: note.trim() || null,
        counted: null,
      };
      setRows((prev) => [...prev, newRow]);
      setQty("");
      setNote("");
      setDate(today());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(adjId: number) {
    const res = await fetch(`/api/inventory/${itemId}/adjustments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjId }),
    });
    if (!res.ok) return;
    setRows((prev) => prev.filter((r) => r.id !== adjId));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-slate-500">
                <th className="pb-1 pr-4 font-medium">Date</th>
                <th className="pb-1 pr-4 font-medium">Reason</th>
                <th className="pb-1 pr-4 text-right font-medium">Counted</th>
                <th className="pb-1 pr-4 text-right font-medium">Qty</th>
                <th className="pb-1 pr-4 font-medium">Note</th>
                <th className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 tabular-nums text-slate-500">{r.adjustedOn ?? "—"}</td>
                  <td className="py-2 pr-4">{REASON_LABELS[r.reason] ?? r.reason}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-600">{r.counted ?? "—"}</td>
                  <td className={`py-2 pr-4 text-right tabular-nums font-medium ${r.qty >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {r.qty >= 0 ? `+${r.qty}` : r.qty}
                  </td>
                  <td className="py-2 pr-4 text-slate-500">{r.note ?? ""}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="text-xs text-red-500 hover:underline"
                      aria-label="Delete adjustment"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-400">No adjustments yet.</p>
      )}

      {/* Add form */}
      <div className="rounded-xl border border-line p-3">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Add adjustment</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Date
            <input
              type="date"
              className={INPUT_CLASS}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Reason
            <select
              className={INPUT_CLASS}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="sample">Sample</option>
              <option value="damage_loss">Damage / Loss</option>
              <option value="recount">Recount</option>
              <option value="other">Other</option>
            </select>
          </label>
          {!whatnotOnly && (
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Channel
              <select
                className={INPUT_CLASS}
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="warehouse">Warehouse</option>
                <option value="whatnot">Whatnot</option>
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Qty (signed)
            <input
              type="number"
              className={`w-24 ${INPUT_CLASS}`}
              value={qty}
              onChange={(e) => { setQty(e.target.value); setQtyError(null); }}
              placeholder="e.g. −2"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Note (optional)
            <input
              type="text"
              className={`w-40 ${INPUT_CLASS}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note"
            />
          </label>
          <Button onClick={handleAdd} disabled={saving}>Add</Button>
        </div>
        {qtyError && <p className="mt-2 text-sm text-red-600">{qtyError}</p>}
      </div>
    </div>
  );
}
