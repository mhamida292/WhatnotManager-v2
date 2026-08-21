"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { ItemCombobox } from "@/components/ItemCombobox";

async function post(url: string, body: unknown) {
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  location.reload();
}

export function InventoryForms({ items, seenNames = [] }: { items: { id: number; name: string }[]; seenNames?: { productName: string; mapped: boolean }[] }) {
  const [alias, setAlias] = useState<{ productName: string; itemId: number | null }>({ productName: "", itemId: items[0]?.id ?? null });

  return (
    <div className="text-sm">
      <Card title="Map Whatnot name → item">
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault();
          if (alias.itemId == null) return;
          post("/api/aliases", { productName: alias.productName, itemId: alias.itemId }); }}>
          <input className={`w-full ${INPUT_CLASS}`} list="seen-product-names" placeholder="Whatnot product name"
            value={alias.productName} onChange={(e) => setAlias({ ...alias, productName: e.target.value })} />
          <datalist id="seen-product-names">
            {seenNames.map((s) => <option key={s.productName} value={s.productName}>{s.mapped ? "(mapped) " : ""}{s.productName}</option>)}
          </datalist>
          <ItemCombobox
            items={items}
            value={alias.itemId}
            onChange={(id) => setAlias({ ...alias, itemId: id })}
            listId="map-item-names"
            placeholder="Search inventory item…"
          />
          <Button type="submit" disabled={alias.itemId == null}>Map</Button>
        </form>
      </Card>
    </div>
  );
}
