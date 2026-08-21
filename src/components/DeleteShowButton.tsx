"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShowDeleteImpact } from "@/lib/db/shows";

/** Deletes a show after a confirm spelling out what's removed. Redirects to the
 *  shows list on success. */
export function DeleteShowButton({ id, showDate, impact }: { id: number; showDate: string; impact: ShowDeleteImpact }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  function message(): string {
    let detail = "";
    if (impact.ledgerTxns > 0) {
      const sales = impact.ledgerSales === 1 ? "1 sale" : `${impact.ledgerSales} sales`;
      detail = ` and its ${impact.ledgerTxns} ${impact.ledgerTxns === 1 ? "transaction" : "transactions"} (${sales})`;
    } else if (impact.lineItems > 0) {
      detail = ` and its ${impact.lineItems} ${impact.lineItems === 1 ? "line item" : "line items"}`;
    }
    return `Delete show ${showDate}? This permanently removes the show${detail}. This can't be undone — re-importing the same CSV would recreate it.`;
  }

  async function del() {
    if (!confirm(message())) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/shows", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) { setError(true); setBusy(false); return; }
      router.push("/shows");
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <button onClick={del} disabled={busy}
      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50">
      {error ? "Retry delete" : busy ? "Deleting…" : "Delete show"}
    </button>
  );
}
