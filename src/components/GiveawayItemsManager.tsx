"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";

interface GiveawayItem {
  id: number;
  name: string;
  packCostCents: number;
  packQty: number;
  active: boolean;
}

export default function GiveawayItemsManager() {
  const [items, setItems] = useState<GiveawayItem[]>([]);
  const [name, setName] = useState("");
  const [packDollars, setPackDollars] = useState("");
  const [packQty, setPackQty] = useState("1");
  const [error, setError] = useState("");

  async function load() {
    setItems(await fetch("/api/giveaway-items").then((r) => r.json()));
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const packCostCents = Math.round(parseFloat(packDollars) * 100);
    const qty = parseInt(packQty, 10);
    if (!name.trim() || !Number.isFinite(packCostCents) || packCostCents < 0 || !(qty >= 1)) return;
    await fetch("/api/giveaway-items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), packCostCents, packQty: qty }),
    });
    setName(""); setPackDollars(""); setPackQty("1");
    load();
  }

  async function save(it: GiveawayItem) {
    await fetch("/api/giveaway-items", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(it),
    });
    load();
  }

  async function remove(it: GiveawayItem) {
    if (!confirm(`Delete "${it.name}"? This can't be undone.`)) return;
    setError("");
    const res = await fetch(`/api/giveaway-items?id=${it.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not delete item.");
      return;
    }
    load();
  }

  const unit = (it: GiveawayItem) => (it.packCostCents / it.packQty / 100);

  return (
    <Card title="Giveaway items">
      <div className="space-y-4 text-sm">
        <p className="text-slate-500">
          Each giveaway is costed from this list. For bulk items, enter the pack price and how many are in the pack.
        </p>
        {error && <p className="text-amber-700">⚠ {error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-4 font-semibold">Name</th>
                <th className="pb-2 pr-4 font-semibold">Pack cost</th>
                <th className="pb-2 pr-4 font-semibold">Pack qty</th>
                <th className="pb-2 pr-4 font-semibold">Per unit</th>
                <th className="pb-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-slate-400 italic">No items yet — add one below.</td>
                </tr>
              )}
              {items.map((it) => (
                <tr key={it.id} className="border-b border-line last:border-0" style={{ opacity: it.active ? 1 : 0.45 }}>
                  <td className="py-2 pr-4">{it.name}</td>
                  <td className="py-2 pr-4">${(it.packCostCents / 100).toFixed(2)}</td>
                  <td className="py-2 pr-4">{it.packQty}</td>
                  <td className="py-2 pr-4">${unit(it).toFixed(4)}</td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        className="text-xs px-2.5 py-1"
                        onClick={() => save({ ...it, active: !it.active })}
                      >
                        {it.active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        variant="secondary"
                        className="text-xs px-2.5 py-1 text-red-600"
                        onClick={() => remove(it)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Name</span>
            <input
              className={INPUT_CLASS}
              placeholder="e.g. Stickers"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Pack cost $</span>
            <input
              className={INPUT_CLASS}
              placeholder="9.99"
              value={packDollars}
              onChange={(e) => setPackDollars(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Pack qty</span>
            <input
              className={INPUT_CLASS}
              placeholder="600"
              value={packQty}
              onChange={(e) => setPackQty(e.target.value)}
            />
          </label>
          <Button onClick={add}>Add item</Button>
        </div>
      </div>
    </Card>
  );
}
