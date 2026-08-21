"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ItemCombobox } from "@/components/ItemCombobox";
import type { MapSuggestion } from "@/lib/calc/map-suggestions";

async function confirmAlias(productName: string, itemId: number) {
  await fetch("/api/aliases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productName, itemId }),
  });
  location.reload();
}

function Row({ s, items, idx }: { s: MapSuggestion; items: { id: number; name: string }[]; idx: number }) {
  // Pre-select the suggestion, but never auto-apply — the user must click Confirm.
  const [itemId, setItemId] = useState<number | null>(s.suggestedItemId);
  const pct = Math.round(s.score * 100);

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="font-medium">{s.productName}</div>
      <div className="mt-1 text-xs text-slate-500">
        {s.suggestedItemName
          ? <>Best match: <span className="font-mono">{s.suggestedItemName}</span> ({pct}%){!s.confident && " — low confidence, please review"}</>
          : "No inventory items to match against"}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <ItemCombobox
            items={items}
            value={itemId}
            onChange={setItemId}
            listId={`map-${idx}`}
            placeholder="Search inventory item…"
          />
        </div>
        <Button
          onClick={() => { if (itemId != null) confirmAlias(s.productName, itemId); }}
          disabled={itemId == null}
        >
          {itemId === s.suggestedItemId && s.confident ? "Confirm" : "Map"}
        </Button>
      </div>
    </div>
  );
}

export function UnmappedSuggestions({
  suggestions,
  items,
}: {
  suggestions: MapSuggestion[];
  items: { id: number; name: string }[];
}) {
  if (suggestions.length === 0) return null;
  return (
    <Card title={`Unmapped Whatnot names (${suggestions.length}) — confirm a match`}>
      <div className="space-y-2 text-sm">
        {suggestions.map((s, i) => <Row key={s.productName} s={s} items={items} idx={i} />)}
      </div>
    </Card>
  );
}
