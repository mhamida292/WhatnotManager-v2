"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Settings } from "@/lib/db/settings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { sweepConfirmMessage } from "@/lib/ui/sweep-confirm-message";

export function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [businessName, setBusinessName] = useState(initial.businessName ?? "");
  const [invoicePhone, setInvoicePhone] = useState(initial.invoicePhone ?? "");
  const [invoiceAddress, setInvoiceAddress] = useState(initial.invoiceAddress ?? "");
  const [invoiceEmail, setInvoiceEmail] = useState(initial.invoiceEmail ?? "");
  const [showPhone, setShowPhone] = useState(initial.invoiceShowPhone);
  const [showAddress, setShowAddress] = useState(initial.invoiceShowAddress);
  const [showEmail, setShowEmail] = useState(initial.invoiceShowEmail);
  const [whatnotOnly, setWhatnotOnly] = useState(initial.whatnotOnly);
  const [costingMode, setCostingMode] = useState<Settings["costingMode"]>(initial.costingMode);
  const [avgMethod, setAvgMethod] = useState<Settings["avgMethod"]>(initial.avgMethod);
  const [gateError, setGateError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<{ id: number; name: string; qty: number }[]>([]);
  const [saved, setSaved] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Preserved (no longer edited here) so downstream reports/shows keep their values.
        ownerSharePct: initial.ownerSharePct,
        defaultShippingSuppliesCents: initial.defaultShippingSuppliesCents,
        businessName: businessName.trim() || null,
        invoicePhone: invoicePhone.trim() || null,
        invoiceAddress: invoiceAddress.trim() || null,
        invoiceEmail: invoiceEmail.trim() || null,
        invoiceShowPhone: showPhone, invoiceShowAddress: showAddress, invoiceShowEmail: showEmail,
        whatnotOnly,
        costingMode, avgMethod,
      }),
    });
    if (res.status === 409) {
      const j = await res.json();
      const items: { id: number; name: string; qty: number }[] = j.items ?? [];
      const list = items.map((i) => `${i.name} (${i.qty})`).join(", ");
      setGateError(`${items.length} item(s) still have Warehouse stock: ${list}. Move them to Whatnot or adjust them out first.`);
      setBlockers(items);
      setWhatnotOnly(false);
      setSweepMsg(null);
      return;
    }
    if (!res.ok) { alert(`Save failed (${res.status}). ${await res.text()}`); return; }
    setGateError(null);
    setBlockers([]);
    setSweepMsg(null);
    setSaved(true);
  }

  async function sweep() {
    if (!confirm(sweepConfirmMessage(blockers))) return;
    setSweeping(true);
    try {
      const res = await fetch("/api/inventory/sweep-to-whatnot", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setGateError(data.error ?? "Sweep failed."); return; }
      let text = `Moved ${data.units} units across ${data.items} items.`;
      if (data.corrections > 0) {
        text += ` Corrected ${data.corrections} item${data.corrections === 1 ? "" : "s"} with a negative Warehouse balance.`;
      }
      text += " Whatnot-only mode is now on.";
      setGateError(null);
      setBlockers([]);
      setWhatnotOnly(true);
      setSweepMsg(text);
      setSaved(false);
      router.refresh();
    } finally {
      setSweeping(false);
    }
  }

  const contacts = [
    { label: "Telephone", v: invoicePhone, setV: setInvoicePhone, show: showPhone, setShow: setShowPhone, placeholder: "(313) 555-0142" },
    { label: "Address", v: invoiceAddress, setV: setInvoiceAddress, show: showAddress, setShow: setShowAddress, placeholder: "123 Warehouse Ave, City, ST 00000" },
    { label: "Email", v: invoiceEmail, setV: setInvoiceEmail, show: showEmail, setShow: setShowEmail, placeholder: "billing@yourbiz.com" },
  ];

  return (
    <Card title="Business & invoice">
      <form className="max-w-md space-y-5 text-sm" onSubmit={save}>
        <div>
          <label className="block font-medium text-slate-700">Business name</label>
          <input className={`mt-1 w-full ${INPUT_CLASS}`} placeholder="Your business name"
            value={businessName} onChange={(e) => { setBusinessName(e.target.value); setSaved(false); }} />
          <p className="mt-1 text-xs text-slate-400">Shown on the on-screen invoice view. The printable PDF uses the contact details below.</p>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Invoice contact <span className="font-normal normal-case text-slate-400">— printed on the invoice PDF</span>
          </p>
          {contacts.map((f) => (
            <div key={f.label}>
              <div className="flex items-center justify-between">
                <label className="font-medium text-slate-700">{f.label}</label>
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  <input type="checkbox" checked={f.show}
                    onChange={(e) => { f.setShow(e.target.checked); setSaved(false); }} /> show on invoice
                </label>
              </div>
              <input className={`mt-1 w-full ${INPUT_CLASS} ${f.show ? "" : "opacity-50"}`} placeholder={f.placeholder}
                value={f.v} onChange={(e) => { f.setV(e.target.value); setSaved(false); }} />
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-line pt-4">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={whatnotOnly}
              onChange={(e) => { setWhatnotOnly(e.target.checked); setSaved(false); }} />
            Whatnot-only mode — hide Warehouse stock and the Move action
          </label>
          {gateError && <p className="text-sm text-red-600">{gateError}</p>}
          {blockers.length > 0 && (
            <Button type="button" onClick={sweep} disabled={sweeping}>
              {sweeping ? "Moving…" : "Move all Warehouse stock to Whatnot and turn on Whatnot-only mode"}
            </Button>
          )}
          {sweepMsg && <p className="text-sm text-brand-700">{sweepMsg}</p>}
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Costing</p>
          <div>
            <label className="block font-medium text-slate-700">Costing mode</label>
            <select className={`mt-1 w-full ${INPUT_CLASS}`} value={costingMode}
              onChange={(e) => { setCostingMode(e.target.value as Settings["costingMode"]); setSaved(false); }}>
              <option value="per_sku">Per-SKU — costs each sale via product mapping</option>
              <option value="pooled">Pooled — one blended cost across all purchased stock (for mystery/random-pull streams)</option>
            </select>
          </div>
          {costingMode === "pooled" && (
            <div>
              <label className="block font-medium text-slate-700">Pool average method</label>
              <select className={`mt-1 w-full ${INPUT_CLASS}`} value={avgMethod}
                onChange={(e) => { setAvgMethod(e.target.value as Settings["avgMethod"]); setSaved(false); }}>
                <option value="moving">Moving average — a show's cost never changes once booked</option>
                <option value="live">Live average — all-time blended, shifts past shows when you buy more</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line pt-4">
          <Button type="submit">Save</Button>
          {saved && <span className="text-brand-700">Saved ✓</span>}
        </div>
      </form>
    </Card>
  );
}
