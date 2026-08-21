"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";

interface PreviewRow { buyerUsername: string; productName: string; quantity: number; priceCents: number; status: string; }
interface Preview { rows: PreviewRow[]; unmapped: string[]; }

function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function ShowUpload({ defaultGiveawayUnitCents = 500, defaultShippingCents = 0 }: { defaultGiveawayUnitCents?: number; defaultShippingCents?: number }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [csvText, setCsvText] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [showDate, setShowDate] = useState(new Date().toISOString().slice(0, 10));
  const [payout, setPayout] = useState("");
  const [shipping, setShipping] = useState(defaultShippingCents ? (defaultShippingCents / 100).toFixed(2) : "");
  const [giveUnit, setGiveUnit] = useState((defaultGiveawayUnitCents / 100).toString());
  const [saving, setSaving] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    const res = await fetch("/api/shows/preview", { method: "POST", body: text });
    const data: Preview = await res.json();
    setStatuses(data.rows.map((r) => r.status));
    setPreview(data);
  }

  async function save() {
    if (!showDate.trim()) { alert("Enter a date for this show first."); return; }
    if (payout.trim() === "") { alert("Enter the payout (from your Whatnot Shipments page) before saving."); return; }
    const rows = preview!.rows;
    const giveawayCount = statuses.filter((s) => s === "giveaway").length;
    const lines = rows.map((r, i) => ({
      buyerUsername: r.buyerUsername, productName: r.productName,
      quantity: r.quantity, revenueCents: r.priceCents, status: statuses[i],
    }));
    setSaving(true);
    try {
      const res = await fetch("/api/shows", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showDate, payoutCents: Math.round(Number(payout) * 100),
          shippingSuppliesCents: Math.round(Number(shipping) * 100),
          giveawayCount, giveawayUnitCents: Math.round(Number(giveUnit) * 100),
          sourceHash: hashText(csvText), lines,
        }),
      });
      if (!res.ok) { alert(`Save failed (${res.status}). ${await res.text()}`); setSaving(false); return; }
      window.location.href = `/shows/${(await res.json()).id}`;
    } catch (err) {
      alert(`Save failed: ${err}`);
      setSaving(false);
    }
  }

  return (
    <Card>
      <input type="file" accept=".csv" onChange={onFile} />
      {preview && (
        <div className="mt-4 space-y-3">
          {preview.unmapped.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Unmapped products (map them on the Inventory page first): {preview.unmapped.join(", ")}
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            <label>Date <input className={`${INPUT_CLASS}`} value={showDate} onChange={(e) => setShowDate(e.target.value)} placeholder="2026-06-11" /></label>
            <label>Payout $ <input className={`${INPUT_CLASS}`} value={payout} onChange={(e) => setPayout(e.target.value)} /></label>
            <label>Shipping supplies $ <input className={`${INPUT_CLASS}`} value={shipping} onChange={(e) => setShipping(e.target.value)} /></label>
            <label>Giveaway unit $ <input className={`${INPUT_CLASS} w-24`} value={giveUnit} onChange={(e) => setGiveUnit(e.target.value)} /></label>
          </div>
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b"><th className="p-1">Buyer</th><th className="p-1">Product</th><th className="p-1">Qty</th><th className="p-1">Price</th><th className="p-1">Status</th></tr></thead>
            <tbody>
              {preview.rows.map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="p-1">{r.buyerUsername}</td>
                  <td className="p-1">{r.productName}</td>
                  <td className="p-1">{r.quantity}</td>
                  <td className="p-1">${(r.priceCents / 100).toFixed(2)}</td>
                  <td className="p-1">
                    <select className={INPUT_CLASS} value={statuses[i] ?? r.status} onChange={(e) => { const next = [...statuses]; next[i] = e.target.value; setStatuses(next); }}>
                      <option value="confirmed">confirmed</option>
                      <option value="cancelled">cancelled</option>
                      <option value="failed">failed</option>
                      <option value="giveaway">giveaway</option>
                      <option value="suspected_duplicate">suspected_duplicate</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save show"}</Button>
        </div>
      )}
    </Card>
  );
}
