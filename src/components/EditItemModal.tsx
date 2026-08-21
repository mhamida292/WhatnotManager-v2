"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { PurchaseList, type PurchaseRow } from "@/components/PurchaseList";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { toCents, toDollars } from "@/lib/money";
import { AdjustmentsLog } from "@/components/AdjustmentsLog";

const today = () => new Date().toISOString().slice(0, 10);

export function EditItemModal({ itemId, name, location, initialPurchases, onClose, whatnotOnly }: {
  itemId: number; name: string; location: string | null; initialPurchases: PurchaseRow[]; onClose: () => void; whatnotOnly?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PurchaseRow[]>(initialPurchases);

  // Details panel — pending until Save.
  const [dName, setDName] = useState(name);
  const [dLoc, setDLoc] = useState(location ?? "");
  const [committed, setCommitted] = useState({ name });
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const dirty = dName !== committed.name;

  // Purchase form — hidden until +Add or editing a row.
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: today(), qty: "", cost: "" });
  const [editing, setEditing] = useState<number | null>(null);
  const [purchaseError, setPurchaseError] = useState(false);

  function close() { router.refresh(); onClose(); }

  async function saveDetails() {
    if (dName.trim() === "") { setDetailsError("Name cannot be empty."); return; }
    const res = await fetch("/api/inventory", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: itemId, name: dName.trim() }),
    });
    if (!res.ok) {
      const msg = res.status === 409 ? "An item with that name already exists." : "Could not save — check the values.";
      setDetailsError(msg); return;
    }
    setDetailsError(null);
    setDName(dName.trim());
    setCommitted({ name: dName.trim() });
    router.refresh();
  }

  function cancelDetails() {
    setDName(committed.name);
    setDetailsError(null);
  }

  function openAdd() { setPurchaseError(false); setEditing(null); setForm({ date: today(), qty: "", cost: "" }); setShowForm(true); }
  function startEdit(p: PurchaseRow) {
    setPurchaseError(false);
    setEditing(p.id);
    setForm({ date: p.purchasedOn ?? "", qty: String(p.quantity), cost: toDollars(p.unitCostCents).toFixed(2) });
    setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditing(null); setForm({ date: today(), qty: "", cost: "" }); }

  async function addOrSave() {
    const qty = Math.trunc(Number(form.qty));
    const cents = toCents(Number(form.cost));
    if (!(qty >= 1) || !(cents >= 0)) { setPurchaseError(true); return; }
    setPurchaseError(false);
    const body = { id: editing, itemId, purchasedOn: form.date || null, quantity: qty, unitCostCents: cents };
    const res = await fetch("/api/purchases", {
      method: editing == null ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { setPurchaseError(true); return; }
    if (editing == null) {
      const { id } = await res.json();
      setRows([...rows, { id, purchasedOn: form.date || null, quantity: qty, unitCostCents: cents }]);
    } else {
      setRows(rows.map((r) => r.id === editing ? { ...r, purchasedOn: form.date || null, quantity: qty, unitCostCents: cents } : r));
    }
    closeForm();
  }

  async function remove(id: number) {
    const res = await fetch("/api/purchases", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (!res.ok) { setPurchaseError(true); return; }
    setRows(rows.filter((r) => r.id !== id));
  }

  return (
    <Modal title="Edit item" onClose={close} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Details</p>
          <label className="mb-2 block text-sm">
            <span className="text-slate-500">Name</span>
            <input type="text" className={`mt-1 w-full ${INPUT_CLASS}`} value={dName} onChange={(e) => setDName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">Location</span>
            <input className={`w-full ${INPUT_CLASS}`} placeholder="e.g. A3-2"
              value={dLoc} onChange={(e) => setDLoc(e.target.value)}
              onBlur={() => fetch("/api/inventory", { method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: itemId, location: dLoc.trim() || null }) })} />
          </label>
          {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
          {detailsError && <p className="mt-2 text-sm text-red-600">{detailsError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={cancelDetails} disabled={!dirty}>Cancel</Button>
            <Button onClick={saveDetails} disabled={!dirty}>Save</Button>
          </div>
        </div>

        <div className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-slate-500">Purchase history</p>
            {!showForm && <Button variant="secondary" onClick={openAdd}>+ Add purchase</Button>}
          </div>
          <PurchaseList purchases={rows} onEdit={startEdit} onDelete={remove} />

          {showForm && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{editing == null ? "Add a purchase" : "Edit purchase"}</p>
              <div className="flex flex-wrap items-end gap-2">
                <input type="date" className={INPUT_CLASS} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                <input type="number" min="1" placeholder="Qty" className={`w-20 ${INPUT_CLASS}`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                <input type="number" step="0.01" min="0" placeholder="Unit cost $" className={`w-28 ${INPUT_CLASS}`} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
                <Button onClick={addOrSave}>{editing == null ? "Add" : "Save"}</Button>
                <Button variant="secondary" onClick={closeForm}>Cancel</Button>
              </div>
              {purchaseError && <p className="mt-2 text-sm text-red-600">Something went wrong — check the values and try again.</p>}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Adjustments</p>
          <AdjustmentsLog itemId={itemId} initial={[]} whatnotOnly={whatnotOnly} />
        </div>

        <div className="flex justify-end"><Button variant="secondary" onClick={close}>Done</Button></div>
      </div>
    </Modal>
  );
}
