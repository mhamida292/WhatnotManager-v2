"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/** Export the whole database to Excel, or restore it from a backup workbook
 *  (replace-all, behind a confirm). */
export function BackupRestore() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function restore() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("Choose a .xlsx backup file first."); return; }
    const sum = await fetch("/api/backup/summary").then((r) => r.json()).catch(() => null);
    const counts: Record<string, number> | null = sum?.counts ?? null;
    let what: string;
    if (!counts) {
      what = "UNKNOWN — couldn't read the current workspace contents. This will still permanently erase everything in it";
    } else {
      const notable = ["inventory_items", "invoices", "ledger_transactions", "shows", "expenses"]
        .filter((t) => counts[t])
        .map((t) => `${counts[t]} ${t.replace(/_/g, " ")}`);
      if (notable.length) {
        what = notable.join(", ");
      } else {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        what = total > 0
          ? `${total} rows across ${Object.keys(counts).length} tables`
          : "the current (empty) workspace";
      }
    }
    if (!confirm(`This REPLACES all current data with the file's contents and can't be undone.\n\nAbout to delete: ${what}.\n\nContinue?`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/backup/import", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? `Restore failed (${res.status}).`); return; }
      const total = Object.values(data.counts as Record<string, number>).reduce((a, b) => a + b, 0);
      let text = `Restored ${total} rows across ${Object.keys(data.counts).length} tables.`;
      if (data.legacy) {
        text += " Imported from an older backup — Whatnot name mappings were converted to identifiers and SKUs were assigned.";
        if (data.skipped?.length) text += ` Not imported: ${data.skipped.join(", ")}.`;
      }
      const drift = data.columnDrift as { table: string; added: string[]; dropped: string[] }[] | undefined;
      if (drift?.length) {
        const parts = drift.map((d) => {
          const bits: string[] = [];
          if (d.added.length) bits.push(`+${d.added.join(", ")} (now at defaults)`);
          if (d.dropped.length) bits.push(`-${d.dropped.join(", ")} (no longer kept)`);
          return `${d.table}: ${bits.join("; ")}`;
        });
        text += ` This file's schema differs from this version — ${parts.join(" | ")}.`;
      }
      setMsg(text);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (e) {
      setErr(`Restore failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line p-5">
      <h2 className="font-semibold text-slate-800">Backup</h2>
      <p className="mt-1 text-sm text-slate-600">
        Export your entire database to an Excel file, or restore it from one. Restoring replaces all current data.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a href="/api/backup/export"
          className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          Export to Excel
        </a>
        <input ref={fileRef} type="file" accept=".xlsx" className="text-sm" />
        <Button variant="secondary" onClick={restore} disabled={busy}>
          {busy ? "Restoring…" : "Import / Restore"}
        </Button>
      </div>
      {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
