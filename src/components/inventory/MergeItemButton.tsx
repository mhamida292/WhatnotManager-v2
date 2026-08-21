"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ItemCombobox } from "@/components/ItemCombobox";

/** Merge THIS item (the loser) into a chosen survivor. All of this item's
 *  purchases, sales, adjustments, and identifiers move to the survivor and this
 *  item is deleted. Irreversible — confirms first. */
export function MergeItemButton({ itemId, itemName, others }: {
  itemId: number; itemName: string; others: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [survivorId, setSurvivorId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    if (survivorId == null) return;
    const survivorName = others.find((o) => o.id === survivorId)?.name ?? "the selected item";
    if (!confirm(`Merge "${itemName}" into "${survivorName}"? All of "${itemName}"'s purchases, sales, adjustments, and identifiers move to "${survivorName}", and "${itemName}" is permanently deleted. This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/inventory/merge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loserId: itemId, survivorId }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
      router.push("/inventory");
    } catch { setError("Failed"); setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-[220px]">
        <ItemCombobox items={others} value={survivorId} onChange={setSurvivorId} listId="merge-survivor" placeholder="Merge into which item?" />
      </div>
      <Button variant="secondary" onClick={merge} disabled={busy || survivorId == null}>Merge</Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
