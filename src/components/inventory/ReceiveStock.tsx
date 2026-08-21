"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function ReceiveStock({ items }: { items: { id: number; name: string }[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ itemId: "", quantity: "", cost: "", purchasedOn: today });
  return (
    <Card title="Receive stock">
      <form className="space-y-2 text-sm max-w-sm" onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/inventory/receive", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: Number(f.itemId), quantity: Number(f.quantity),
            unitCostCents: Math.round(Number(f.cost) * 100), purchasedOn: f.purchasedOn || null }) });
        if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not receive stock");
      }}>
        <select className={`w-full ${INPUT_CLASS}`} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })} required>
          <option value="">Select item…</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Quantity received" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Unit cost $" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
        <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.purchasedOn} onChange={(e) => setF({ ...f, purchasedOn: e.target.value })} />
        <Button type="submit">Receive</Button>
      </form>
    </Card>
  );
}
