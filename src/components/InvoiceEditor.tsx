"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Money } from "@/components/Money";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { toCents } from "@/lib/money";
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";

export function InvoiceEditor({ invoice, lines: initialLines, items }: {
  invoice: Invoice; lines: InvoiceLine[]; items: { id: number; name: string }[];
}) {
  const router = useRouter();
  const isSale = invoice.direction === "sale";

  const [supplier, setSupplier] = useState(invoice.supplier ?? "");
  const [customer, setCustomer] = useState(invoice.customer ?? "");
  const [date, setDate] = useState(invoice.invoiceDate ?? "");
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [lines, setLines] = useState<InvoiceLine[]>(initialLines);
  const [form, setForm] = useState({ itemId: "", name: "", qty: "", cost: "", packs: "", perPack: "" });
  const [chargeForm, setChargeForm] = useState({ name: "", amount: "" });
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce(
    (s, l) => s + l.quantity * (isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents),
    0,
  );

  async function saveHeader() {
    await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isSale
          ? { customer: customer || null, invoiceDate: date || null, notes: notes || null }
          : { supplier: supplier || null, invoiceDate: date || null, notes: notes || null },
      ),
    });
    router.refresh();
  }

  function pickItem(v: string) {
    const it = items.find((i) => String(i.id) === v);
    setForm({ ...form, itemId: v, name: it ? it.name : "" });
  }

  function computePacks() {
    const packs = Math.trunc(Number(form.packs));
    const perPack = Math.trunc(Number(form.perPack));
    if (packs > 0 && perPack > 0) setForm({ ...form, qty: String(packs * perPack) });
  }

  async function addLine() {
    const qty = Math.trunc(Number(form.qty));

    if (isSale) {
      const cents = toCents(Number(form.cost));
      if (!form.itemId) { setError("Select an item."); return; }
      if (!(qty >= 1)) { setError("Enter a valid quantity."); return; }
      if (!(cents >= 0)) { setError("Enter a valid unit price."); return; }
      const name = items.find((i) => String(i.id) === form.itemId)?.name ?? "";
      setError(null);
      const res = await fetch(`/api/invoices/${invoice.id}/lines`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: Number(form.itemId), productName: name, quantity: qty, unitCostCents: 0, unitPriceCents: cents }),
      });
      if (!res.ok) { setError("Could not add line."); return; }
      const { id } = await res.json();
      setLines([...lines, { id, invoiceId: invoice.id, itemId: Number(form.itemId), productName: name, displayName: name, quantity: qty, unitCostCents: 0, unitPriceCents: cents, kind: "item" }]);
      setForm({ itemId: "", name: "", qty: "", cost: "", packs: "", perPack: "" });
      router.refresh();
    } else {
      const cents = toCents(Number(form.cost));
      const name = form.itemId ? (items.find((i) => String(i.id) === form.itemId)?.name ?? "") : form.name.trim();
      if (!name || !(qty >= 1) || !(cents >= 0)) { setError("Enter a product, quantity ≥ 1, and a cost."); return; }
      setError(null);
      const res = await fetch(`/api/invoices/${invoice.id}/lines`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: form.itemId || null, productName: name, quantity: qty, unitCostCents: cents }),
      });
      if (!res.ok) { setError("Could not add line."); return; }
      const { id } = await res.json();
      setLines([...lines, { id, invoiceId: invoice.id, itemId: form.itemId ? Number(form.itemId) : null, productName: name, displayName: name, quantity: qty, unitCostCents: cents, unitPriceCents: null, kind: "item" }]);
      setForm({ itemId: "", name: "", qty: "", cost: "", packs: "", perPack: "" });
      router.refresh();
    }
  }

  async function addCharge() {
    const name = chargeForm.name.trim();
    const amount = Number(chargeForm.amount);
    if (!name || !Number.isFinite(amount) || amount === 0) { setError("Enter a name and a non-zero amount."); return; }
    setError(null);
    const cents = Math.round(amount * 100);
    const res = await fetch(`/api/invoices/${invoice.id}/lines`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "charge", name, amountCents: cents }),
    });
    if (!res.ok) { setError("Could not add charge."); return; }
    const { id } = await res.json();
    setLines([...lines, { id, invoiceId: invoice.id, itemId: null, productName: name, displayName: name, quantity: 1, unitCostCents: cents, unitPriceCents: cents, kind: "charge" }]);
    setChargeForm({ name: "", amount: "" });
    router.refresh();
  }

  async function removeLine(id: number) {
    const res = await fetch(`/api/invoices/${invoice.id}/lines`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (res.ok) { setLines(lines.filter((l) => l.id !== id)); router.refresh(); }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3">
        {isSale ? (
          <input className={INPUT_CLASS} placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} onBlur={saveHeader} />
        ) : (
          <input className={INPUT_CLASS} placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} onBlur={saveHeader} />
        )}
        <input type="date" className={INPUT_CLASS} value={date} onChange={(e) => setDate(e.target.value)} onBlur={saveHeader} />
        <input className={INPUT_CLASS} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveHeader} />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-400">
            <th className="py-1">Product</th><th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">{isSale ? "Unit price" : "Unit cost"}</th>
            <th className="py-1 text-right">Total</th><th />
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr className="border-t border-line">
              <td colSpan={5} className="py-4 text-center text-slate-400">
                No lines yet — add one below.
              </td>
            </tr>
          )}
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="py-1.5">{l.displayName}</td>
              <td className="py-1.5 text-right tabular-nums">{l.kind === "charge" ? "—" : l.quantity}</td>
              <td className="py-1.5 text-right tabular-nums">
                {l.kind === "charge" ? "—" : <Money cents={isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents} />}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                <Money cents={l.kind === "charge" ? (isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents) : l.quantity * (isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents)} />
              </td>
              <td className="py-1.5 text-right"><button onClick={() => removeLine(l.id)} className="text-xs text-red-600 hover:underline">✕</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold">
            <td colSpan={3} className="py-1.5">Total</td>
            <td className="py-1.5 text-right"><Money cents={total} /></td>
            <td />
          </tr>
        </tfoot>
      </table>

      <div className="rounded-xl border border-line p-3">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Add a line</p>
        {isSale ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <select className={INPUT_CLASS} value={form.itemId} onChange={(e) => pickItem(e.target.value)}>
                <option value="">Select item…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <input type="number" min="0" placeholder="Qty (pcs)" className={`w-24 ${INPUT_CLASS}`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
              <input type="number" step="0.01" min="0" placeholder="Unit price $" className={`w-28 ${INPUT_CLASS}`} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
              <Button onClick={addLine}>Add</Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span>Pack helper:</span>
              <input type="number" min="0" placeholder="Packs" className={`w-20 ${INPUT_CLASS} text-xs`} value={form.packs} onChange={(e) => setForm({ ...form, packs: e.target.value })} />
              <span>×</span>
              <input type="number" min="0" placeholder="Per pack" className={`w-20 ${INPUT_CLASS} text-xs`} value={form.perPack} onChange={(e) => setForm({ ...form, perPack: e.target.value })} />
              <Button variant="secondary" onClick={computePacks}>→ Qty</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <select className={INPUT_CLASS} value={form.itemId} onChange={(e) => pickItem(e.target.value)}>
              <option value="">New product…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            {!form.itemId && <input className={INPUT_CLASS} placeholder="New product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            <input type="number" min="0" placeholder="Qty" className={`w-20 ${INPUT_CLASS}`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            <input type="number" step="0.01" min="0" placeholder="Unit cost $" className={`w-28 ${INPUT_CLASS}`} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            <Button onClick={addLine}>Add</Button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line p-3">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Add charge / deduction</p>
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={INPUT_CLASS}
            placeholder="Name (e.g. Shipping, Discount)"
            value={chargeForm.name}
            onChange={(e) => setChargeForm({ ...chargeForm, name: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Amount $ (negative for deduction)"
            className={`w-56 ${INPUT_CLASS}`}
            value={chargeForm.amount}
            onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
          />
          <Button onClick={addCharge}>Add charge / deduction</Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
