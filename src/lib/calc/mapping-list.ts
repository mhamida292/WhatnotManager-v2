/** Search and ordering for the Whatnot mappings page. */
import type { WhatnotMapping } from "@/lib/db/aliases";
import type { ArchiveFilter } from "@/lib/ui/filter-inventory";

export type MappingRow = WhatnotMapping;
export type MappingSortKey = "productName" | "itemName" | "saleCount" | "lastSoldOn";
export type MappingSortDir = "asc" | "desc";

export function filterMappings(rows: MappingRow[], query: string, archive: ArchiveFilter): MappingRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) =>
    (archive === "all" || (archive === "archived") === r.archived) &&
    (!q || r.productName.toLowerCase().includes(q) || r.itemName.toLowerCase().includes(q)));
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** Never-sold names stay last whichever way last-sold runs. Ties fall back to
 *  the Whatnot name so an item's names sit together in a stable order. */
export function sortMappings(rows: MappingRow[], key: MappingSortKey, dir: MappingSortDir): MappingRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "lastSoldOn" && (a.lastSoldOn == null) !== (b.lastSoldOn == null)) return a.lastSoldOn == null ? 1 : -1;
    const cmp =
      key === "saleCount" ? a.saleCount - b.saleCount :
      key === "lastSoldOn" ? byText(a.lastSoldOn ?? "", b.lastSoldOn ?? "") :
      byText(a[key], b[key]);
    return cmp * sign || byText(a.productName, b.productName);
  });
}
