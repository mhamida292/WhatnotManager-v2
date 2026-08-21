"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ArchiveButton({ itemId, archived, nudge = false }: { itemId: number; archived: boolean; nudge?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = archived ? "Unarchive" : nudge ? "Archive?" : "Archive";
  const cls = archived
    ? "text-sm font-medium text-emerald-700 hover:underline"
    : nudge
      ? "text-sm font-medium text-amber-700 hover:underline"
      : "text-sm font-medium text-slate-500 hover:underline";
  async function go() {
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory/${itemId}/archive`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });
      if (res.ok) router.refresh();
    } catch { /* network error — leave state unchanged; button re-enables via finally */
    } finally { setBusy(false); }
  }
  return <button onClick={go} disabled={busy} className={cls}>{label}</button>;
}
