"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function MoveStock({ itemId, itemName, warehouse, whatnot }: { itemId: number; itemName: string; warehouse: number; whatnot: number }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ quantity: "", direction: "to_whatnot", movedOn: today });
  return (
    <>
      <button className="text-brand-700 hover:underline" onClick={() => setOpen(true)} aria-label={`Move ${itemName}`}>⇄ Move</button>
      {open && (
        <Modal title={`Move — ${itemName}`} onClose={() => setOpen(false)}>
          <p className="mb-3 text-sm text-slate-500">Warehouse {warehouse} · Whatnot {whatnot}</p>
          <form className="space-y-2 text-sm max-w-sm" onSubmit={async (e) => {
            e.preventDefault();
            const res = await fetch("/api/inventory/move", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId, quantity: Number(f.quantity), direction: f.direction, movedOn: f.movedOn || null }) });
            if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not move");
          }}>
            <select className={`w-full ${INPUT_CLASS}`} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="to_whatnot">Warehouse → Whatnot</option>
              <option value="to_warehouse">Whatnot → Warehouse</option>
            </select>
            <input className={`w-full ${INPUT_CLASS}`} placeholder="Quantity" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
            <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.movedOn} onChange={(e) => setF({ ...f, movedOn: e.target.value })} />
            <Button type="submit">Move</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
