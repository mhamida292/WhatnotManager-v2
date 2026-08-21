"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { toCents } from "@/lib/money";

const today = () => new Date().toISOString().slice(0, 10);

export function AddProductModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", date: today(), qty: "", cost: "" });
  const [error, setError] = useState(false);

  async function add() {
    const qty = Math.trunc(Number(f.qty));
    const cents = toCents(Number(f.cost));
    if (!f.name.trim() || !(qty >= 1) || !(cents >= 0)) { setError(true); return; }
    setError(false);
    const res = await fetch("/api/inventory", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.name.trim(), lotId: null, purchasedOn: f.date || null, quantity: qty, unitCostCents: cents }),
    });
    if (!res.ok) { setError(true); return; }
    router.refresh();
    onClose();
  }

  return (
    <Modal title="Add product" onClose={onClose}>
      <div className="space-y-3">
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <p className="text-xs font-semibold uppercase text-slate-500">First purchase</p>
        <div className="flex flex-wrap items-end gap-2">
          <input type="date" className={INPUT_CLASS} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <input type="number" min="1" placeholder="Qty" className={`w-20 ${INPUT_CLASS}`} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          <input type="number" step="0.01" min="0" placeholder="Unit cost $" className={`w-28 ${INPUT_CLASS}`} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
        </div>
        {error && <p className="text-sm text-red-600">Enter a name, a quantity ≥ 1, and a cost.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={add}>Add product</Button>
        </div>
      </div>
    </Modal>
  );
}
