"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function DangerZone() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function reset() {
    if (confirm !== "RESET") return;
    setBusy(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (!res.ok) { alert(`Reset failed (${res.status}). ${await res.text()}`); return; }
      alert("App reset. All data cleared.");
      window.location.href = "/";
    } catch (err) {
      alert(`Reset failed: ${err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
      <h2 className="font-semibold text-red-800">Danger zone</h2>
      <p className="mt-1 text-sm text-red-700">
        Factory reset wipes <strong>all</strong> data — shows, imported ledger, inventory, aliases,
        and expenses — and restores default settings. This cannot be undone.
      </p>
      <div className="mt-3 space-y-2">
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Type RESET to confirm"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button variant="danger"
          onClick={reset} disabled={busy || confirm !== "RESET"}>
          {busy ? "Resetting…" : "Reset app"}
        </Button>
      </div>
    </div>
  );
}
