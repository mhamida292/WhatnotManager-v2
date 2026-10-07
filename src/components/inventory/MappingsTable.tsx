"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { longDate } from "@/lib/format-date";
import type { ArchiveFilter } from "@/lib/ui/filter-inventory";
import { filterMappings, sortMappings, type MappingRow, type MappingSortKey, type MappingSortDir } from "@/lib/calc/mapping-list";

const COLUMNS: { key: MappingSortKey; label: string; right?: boolean }[] = [
  { key: "productName", label: "Whatnot name" },
  { key: "itemName", label: "Item" },
  { key: "saleCount", label: "Sales", right: true },
  { key: "lastSoldOn", label: "Last sold" },
];

export function MappingsTable({ rows, countNames }: { rows: MappingRow[]; countNames: string[] }) {
  const [search, setSearch] = useState("");
  const [archive, setArchive] = useState<ArchiveFilter>("active");
  const [key, setKey] = useState<MappingSortKey>("itemName");
  const [dir, setDir] = useState<MappingSortDir>("asc");
  const isCountName = new Set(countNames);

  const onSort = (k: MappingSortKey) => {
    if (k === key) setDir(dir === "asc" ? "desc" : "asc");
    else { setKey(k); setDir(k === "saleCount" || k === "lastSoldOn" ? "desc" : "asc"); }
  };
  const shown = sortMappings(filterMappings(rows, search, archive), key, dir);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" placeholder="Whatnot name or item…" className={`w-64 ${INPUT_CLASS}`}
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={INPUT_CLASS} value={archive} onChange={(e) => setArchive(e.target.value as ArchiveFilter)}>
          <option value="active">Active items</option>
          <option value="archived">Archived items</option>
          <option value="all">Active + archived</option>
        </select>
        <span className="text-sm text-slate-500">{shown.length} of {rows.length}</span>
      </div>

      <DataTable head={<>
        {COLUMNS.map((c) => (
          <th key={c.key} className={`cursor-pointer select-none px-3 py-2 hover:text-slate-700 ${c.right ? "text-right" : ""}`} onClick={() => onSort(c.key)}>
            {c.label}
            <span className="ml-1 text-slate-400">{key === c.key ? (dir === "asc" ? "▲" : "▼") : ""}</span>
          </th>
        ))}
      </>}>
        {shown.length === 0 && (
          <tr><td colSpan={COLUMNS.length} className="px-3 py-3 text-slate-500">No mappings match your filters.</td></tr>
        )}
        {shown.map((r, idx) => (
          <tr key={r.id} className={`border-t border-line ${idx % 2 === 1 ? "bg-slate-50" : ""} ${r.archived ? "text-slate-400" : ""}`}>
            <td className="px-3 py-2">
              {r.productName}
              {isCountName.has(r.productName) && (
                <span className="ml-2 align-middle" title="The name the count sheet shows for this item: its most recently sold">
                  <Badge variant="emerald">Count name</Badge>
                </span>
              )}
            </td>
            <td className="px-3 py-2">
              <Link href={`/inventory/${r.itemId}`} className="font-medium text-emerald-700 hover:underline">{r.itemName}</Link>
              {r.archived && <span className="ml-2 align-middle"><Badge variant="slate">Archived</Badge></span>}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{r.saleCount}</td>
            <td className="px-3 py-2">{longDate(r.lastSoldOn)}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
