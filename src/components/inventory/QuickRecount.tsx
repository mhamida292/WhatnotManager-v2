"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function QuickRecount({ itemId }: { itemId: number }) {
  const router = useRouter();
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("recount");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (counted.trim() === "") { setErr("Enter a whole number (0 or more)."); return; }
    const n = Number(counted);
    if (!Number.isInteger(n) || n < 0) { setErr("Enter a whole number (0 or more)."); return; }
    setErr(null); setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${itemId}/recount`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counted: n, reason }),
      });
      if (!res.ok) { setErr("Save failed."); return; }
      setCounted("");
      router.refresh();
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-slate-500">I counted
        <input type="number" className={`w-24 ${INPUT_CLASS}`} value={counted} onChange={(e) => { setCounted(e.target.value); setErr(null); }} placeholder="e.g. 40" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">Reason
        <select className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="recount">Recount</option>
          <option value="sample">Sample</option>
          <option value="damage_loss">Damage / Loss</option>
          <option value="other">Other</option>
        </select>
      </label>
      <Button onClick={submit} disabled={saving}>Set count</Button>
      {err && <p className="w-full text-sm text-red-600">{err}</p>}
      <p className="w-full text-xs text-slate-400">Records today&apos;s date + the number you counted, and adjusts remaining. Never touches cost.</p>
    </div>
  );
}
