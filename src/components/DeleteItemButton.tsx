"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeleteImpact } from "@/lib/db/inventory";

/** Deletes an inventory item after a confirm that spells out the blast radius.
 *  Ledger mappings are recoverable (re-add + re-map); legacy show links
 *  are not. Redirects to the inventory list on success. */
export function DeleteItemButton({ id, name, impact }: { id: number; name: string; impact: DeleteImpact }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  function message(): string {
    const parts: string[] = [];
    if (impact.mappings > 0) {
      const sales = impact.ledgerSales === 1 ? "1 ledger sale" : `${impact.ledgerSales} ledger sales`;
      parts.push(`removes ${impact.mappings === 1 ? "1 mapping" : `${impact.mappings} mappings`} (${sales} will become unmapped)`);
    }
    if (impact.showLineSales > 0) parts.push(`clears the item from ${impact.showLineSales} legacy show ${impact.showLineSales === 1 ? "sale" : "sales"}`);
    const detail = parts.length ? ` This ${parts.join(" and ")}.` : "";
    return `Delete "${name}"?${detail} The sales data is kept — re-add and re-map to restore ledger counts.`;
  }

  async function del() {
    if (!confirm(message())) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/inventory", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) { setError(true); setBusy(false); return; }
      router.push("/inventory");
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <button onClick={del} disabled={busy}
      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50">
      {error ? "Retry delete" : busy ? "Deleting…" : "Delete item"}
    </button>
  );
}
