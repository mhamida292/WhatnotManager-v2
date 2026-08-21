"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Money } from "@/components/Money";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EditItemModal } from "@/components/EditItemModal";
import { AddProductModal } from "@/components/AddProductModal";
import { ArchiveButton } from "@/components/inventory/ArchiveButton";
import { MoveStock } from "@/components/inventory/MoveStock";
import { BulkActionBar, type BulkAction } from "@/components/inventory/BulkActionBar";
import type { PurchaseRow } from "@/components/PurchaseList";
import { stockBadge } from "@/lib/calc/stock-status";
import { sortInventory, type InvSortKey, type SortDir } from "@/lib/ui/sort-inventory";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { filterInventory, type StockFilter } from "@/lib/ui/filter-inventory";
import { bulkDeleteMessage } from "@/lib/ui/bulk-delete-message";

export interface InventoryRow {
  id: number;
  name: string;
  location: string | null;
  unitCostCents: number;
  qtyPurchased: number;
  sold: number;
  remaining: number;
  warehouse: number;
  whatnot: number;
  purchases: PurchaseRow[];
}

const FULL_COLUMNS: { key: InvSortKey; label: string }[] = [
  { key: "name", label: "Item" },
  { key: "unitCostCents", label: "Avg cost" },
  { key: "qtyPurchased", label: "Purchased" },
  { key: "sold", label: "Sold" },
  { key: "warehouse", label: "Warehouse" },
  { key: "whatnot", label: "Whatnot" },
  { key: "remaining", label: "Total" },
];

const WHATNOT_ONLY_COLUMNS: { key: InvSortKey; label: string }[] = [
  { key: "name", label: "Item" },
  { key: "unitCostCents", label: "Avg cost" },
  { key: "qtyPurchased", label: "Purchased" },
  { key: "sold", label: "Sold" },
  { key: "remaining", label: "In stock" },
];

export function InventoryTable({ items, whatnotOnly }: { items: InventoryRow[]; whatnotOnly?: boolean }) {
  const COLUMNS = whatnotOnly ? WHATNOT_ONLY_COLUMNS : FULL_COLUMNS;
  const router = useRouter();
  const [key, setKey] = useState<InvSortKey>("name");
  const [dir, setDir] = useState<SortDir>("asc");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StockFilter>("all");
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const onSort = (k: InvSortKey) => {
    if (k === key) setDir(dir === "asc" ? "desc" : "asc");
    else { setKey(k); setDir(k === "name" ? "asc" : "desc"); }
  };

  const sorted = sortInventory(filterInventory(items, { search, status }), key, dir);

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clear = () => setSelected(new Set());
  const allVisibleSelected = sorted.length > 0 && sorted.every((i) => selected.has(i.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(sorted.map((i) => i.id)));

  async function runBulk(action: "archive" | "delete") {
    if (bulkBusy) return;
    const ids = [...selected];
    setBulkBusy(true);
    try {
      if (action === "delete") {
        const res = await fetch("/api/inventory/bulk-delete-impact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
        if (!res.ok) return;
        const impact = await res.json();
        if (!confirm(bulkDeleteMessage(impact))) return;
      }
      const r = await fetch("/api/inventory/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids }) });
      if (r.ok) { clear(); router.refresh(); }
    } catch {
      /* network error — leave selection intact, button re-enables via finally */
    } finally {
      setBulkBusy(false);
    }
  }
  const bulkActions: BulkAction[] = [
    { label: "Archive", variant: "primary", onClick: () => runBulk("archive") },
    { label: "Delete", variant: "danger", onClick: () => runBulk("delete") },
  ];

  return (
    <div className="space-y-3">
      <BulkActionBar count={selected.size} actions={bulkActions} onClear={clear} busy={bulkBusy} />
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" placeholder="Search items…" className={`w-48 ${INPUT_CLASS}`}
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={INPUT_CLASS} value={status} onChange={(e) => setStatus(e.target.value as StockFilter)}>
          <option value="all">All</option>
          <option value="in">In stock</option>
          <option value="low">Low</option>
          <option value="out">Out</option>
        </select>
        <div className="ml-auto"><Button onClick={() => setAdding(true)}>+ Add product</Button></div>
      </div>

      <DataTable head={<>
        <th className="px-3 py-2 w-8"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all" /></th>
        {COLUMNS.map((c) => (
          <th key={c.key} className="cursor-pointer select-none px-3 py-2 hover:text-slate-700" onClick={() => onSort(c.key)}>
            {c.label}
            <span className="ml-1 text-slate-400">{key === c.key ? (dir === "asc" ? "▲" : "▼") : ""}</span>
          </th>
        ))}
        <th className="px-3 py-2">Location</th>
        <th className="px-3 py-2" />
      </>}>
        {sorted.length === 0 && (
          <tr><td colSpan={COLUMNS.length + 3} className="px-3 py-3 text-slate-500">No items match your filters.</td></tr>
        )}
        {sorted.map((i) => {
          const badge = stockBadge(i.remaining);
          return (
            <tr key={i.id} className={`border-t border-line ${selected.has(i.id) ? "bg-brand-50" : ""}`}>
              <td className="px-3 py-2"><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.name}`} /></td>
              <td className="px-3 py-2">
                <Link href={`/inventory/${i.id}`} className="font-medium text-emerald-700 hover:underline">{i.name}</Link>
                {badge && (
                  <span className="ml-2 align-middle">
                    <Badge variant={i.remaining <= 0 ? "red" : "amber"}>{badge.label}</Badge>
                  </span>
                )}
              </td>
              <td className="px-3 py-2"><Money cents={i.unitCostCents} /></td>
              <td className="px-3 py-2">{i.qtyPurchased}</td>
              <td className="px-3 py-2">{i.sold}</td>
              {!whatnotOnly && (
                <>
                  <td className={`px-3 py-2 ${i.warehouse < 0 ? "font-semibold text-red-600" : ""}`} title={i.warehouse < 0 ? "Negative warehouse stock — moved out or sold more than on hand." : undefined}>
                    {i.warehouse}{i.warehouse < 0 ? " ⚠" : ""}
                  </td>
                  <td className={`px-3 py-2 ${i.whatnot < 0 ? "font-semibold text-red-600" : ""}`} title={i.whatnot < 0 ? "Oversold — sold more on Whatnot than moved in. Move more stock in." : undefined}>
                    {i.whatnot}{i.whatnot < 0 ? " ⚠" : ""}
                  </td>
                </>
              )}
              <td className="px-3 py-2">{i.remaining}</td>
              <td className="px-3 py-2">{i.location ?? "—"}</td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-3">
                  <button onClick={() => setEditing(i)} className="text-sm font-medium text-emerald-700 hover:underline">Edit</button>
                  {!whatnotOnly && <MoveStock itemId={i.id} itemName={i.name} warehouse={i.warehouse} whatnot={i.whatnot} />}
                  <ArchiveButton itemId={i.id} archived={false} nudge={i.remaining <= 0} />
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>

      {editing && (
        <EditItemModal itemId={editing.id} name={editing.name} location={editing.location} initialPurchases={editing.purchases}
          onClose={() => setEditing(null)} whatnotOnly={whatnotOnly} />
      )}
      {adding && <AddProductModal onClose={() => setAdding(false)} />}
    </div>
  );
}
