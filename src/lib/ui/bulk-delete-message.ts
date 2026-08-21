import type { BulkDeleteImpact } from "@/lib/db/inventory";

/** Human-readable confirmation for a bulk delete, spelling out the blast radius.
 *  Mirrors the single-item DeleteItemButton wording, aggregated. */
export function bulkDeleteMessage(impact: BulkDeleteImpact): string {
  const parts: string[] = [];
  if (impact.mappings > 0) {
    const sales = impact.ledgerSales === 1 ? "1 ledger sale" : `${impact.ledgerSales} ledger sales`;
    parts.push(`unmaps ${impact.mappings === 1 ? "1 Whatnot name" : `${impact.mappings} Whatnot names`} (${sales} become unmapped)`);
  }
  if (impact.showLineSales > 0) parts.push(`detaches ${impact.showLineSales} legacy show ${impact.showLineSales === 1 ? "sale" : "sales"}`);
  const detail = parts.length ? ` This ${parts.join(" and ")}.` : "";
  const n = impact.items;
  return `Delete ${n} ${n === 1 ? "item" : "items"}?${detail} Sales data is kept — re-add and re-map to restore counts. Cannot be undone.`;
}
