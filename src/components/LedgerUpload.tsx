"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface PreviewShow {
  showDate: string; payoutCents: number; saleCount: number;
  giveawayCount: number; tipCount: number; bonusCount: number; otherCount: number;
}
interface Preview { shows: PreviewShow[]; unmapped: string[]; }

export function LedgerUpload() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [csvText, setCsvText] = useState("");
  const [saving, setSaving] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    try {
      const res = await fetch("/api/ledger/preview", { method: "POST", body: text });
      if (!res.ok) { alert(`Preview failed (${res.status}). ${await res.text()}`); return; }
      setPreview(await res.json());
    } catch (err) {
      alert(`Preview failed: ${err}`);
    }
  }

  async function importLedger() {
    setSaving(true);
    try {
      const res = await fetch("/api/ledger", { method: "POST", body: csvText });
      if (!res.ok) { alert(`Import failed (${res.status}). ${await res.text()}`); return; }
      const r = await res.json();
      alert(`Imported ${r.inserted} new transactions across ${r.showsTouched} show(s); skipped ${r.skipped} duplicate(s).`);
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Import Whatnot ledger">
      <input type="file" accept=".csv" onChange={onFile} />
      {preview && (
        <div className="mt-4 space-y-3 text-sm">
          {preview.unmapped.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
              Unmapped products (cost will count as $0 until mapped on the Inventory page): {preview.unmapped.join(", ")}
            </div>
          )}
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b">
              <th className="p-1">Date</th><th className="p-1">Payout</th><th className="p-1">Sales</th>
              <th className="p-1">Giveaways</th><th className="p-1">Tips</th><th className="p-1">Bonus</th><th className="p-1">Other</th>
            </tr></thead>
            <tbody>
              {preview.shows.map((s) => (
                <tr key={s.showDate} className="border-b">
                  <td className="p-1">{s.showDate}</td>
                  <td className="p-1">${(s.payoutCents / 100).toFixed(2)}</td>
                  <td className="p-1">{s.saleCount}</td>
                  <td className="p-1">{s.giveawayCount}</td>
                  <td className="p-1">{s.tipCount}</td>
                  <td className="p-1">{s.bonusCount}</td>
                  <td className="p-1">{s.otherCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button onClick={importLedger} disabled={saving}>
            {saving ? "Importing…" : "Import ledger"}
          </Button>
        </div>
      )}
    </Card>
  );
}
