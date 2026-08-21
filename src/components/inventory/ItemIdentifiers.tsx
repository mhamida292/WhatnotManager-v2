"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import type { ItemIdentifier } from "@/lib/db/inventory";

const SOURCE_LABEL: Record<ItemIdentifier["source"], string> = {
  mine: "SKU", supplier: "Supplier", whatnot: "Whatnot name",
};

export function ItemIdentifiers({ itemId, sku, identifiers }: {
  itemId: number; sku: string | null; identifiers: ItemIdentifier[];
}) {
  const router = useRouter();
  const [skuVal, setSkuVal] = useState(sku ?? "");
  const [addSource, setAddSource] = useState<"supplier" | "whatnot">("supplier");
  const [addCode, setAddCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveSku() {
    if (skuVal.trim() === "" || skuVal.trim() === (sku ?? "")) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/inventory", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: itemId, sku: skuVal.trim() }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setSkuVal(sku ?? ""); }
    else router.refresh();
    setBusy(false);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (addCode.trim() === "") return;
    setBusy(true); setError(null);
    const res = await fetch("/api/identifiers", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, source: addSource, code: addCode.trim() }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
    setAddCode(""); router.refresh(); setBusy(false);
  }

  async function remove(r: ItemIdentifier) {
    const message = r.saleCount > 0
      ? `Remove "${r.code}"? Its ${r.saleCount} sale(s) will stop counting toward this item (remaining goes up, their cost drops to $0 until re-mapped).`
      : `Remove "${r.code}" from this item?`;
    if (!confirm(message)) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/identifiers", { method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
    router.refresh(); setBusy(false);
  }

  return (
    <Card title={`Identifiers (${identifiers.length})`}>
      <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-slate-500">SKU (item identity)</span>
          <input className={`font-mono ${INPUT_CLASS}`} value={skuVal} onChange={(e) => setSkuVal(e.target.value)} onBlur={saveSku} />
        </label>
      </div>

      <table className="w-full text-sm">
        <tbody>{identifiers.map((r) => (
          <tr key={r.id} className="border-b border-line last:border-0">
            <td className="py-2 pr-3 text-xs uppercase text-slate-400">{SOURCE_LABEL[r.source]}</td>
            <td className="py-2 pr-3 font-mono">{r.code}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{r.source === "whatnot" ? `${r.saleCount} ${r.saleCount === 1 ? "sale" : "sales"}` : ""}</td>
            <td className="py-2 text-right">
              {r.source !== "mine" && (
                <button onClick={() => remove(r)} disabled={busy} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">Remove</button>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table>

      <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <select className={INPUT_CLASS} value={addSource} onChange={(e) => setAddSource(e.target.value as "supplier" | "whatnot")}>
          <option value="supplier">Supplier code</option>
          <option value="whatnot">Whatnot name</option>
        </select>
        <input className={`flex-1 ${INPUT_CLASS}`} placeholder="Code or name" value={addCode} onChange={(e) => setAddCode(e.target.value)} />
        <Button type="submit" disabled={busy || addCode.trim() === ""}>Add</Button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
