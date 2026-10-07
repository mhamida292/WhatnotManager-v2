/** Labels, search and ordering for the Count merchandise sheet. Pure, so the
 *  sheet's controls can be tested without rendering it. */

export type NameMode = "whatnot" | "name" | "sku";
export type CountSort = "name" | "expected-desc" | "expected-asc" | "off-first";

export interface CountItem {
  id: number;
  name: string;
  sku: string | null;
  aliases: string[];   // Whatnot names, most-sold first
  expected: number;
}

export interface RowLabel { text: string; fallback: boolean; others: string[]; }

/** What a row is called in the chosen mode. An item with no Whatnot name or no
 *  sku falls back to its own name, flagged so the sheet can grey it out. */
export function rowLabel(it: CountItem, mode: NameMode): RowLabel {
  if (mode === "whatnot" && it.aliases.length > 0) return { text: it.aliases[0], fallback: false, others: it.aliases.slice(1) };
  if (mode === "sku" && it.sku) return { text: it.sku, fallback: false, others: [] };
  return { text: it.name, fallback: mode !== "name", others: [] };
}

/** Matches every name an item goes by, not just the one on screen, so a search
 *  finds the item whichever mode is showing. */
export function matchesSearch(it: CountItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [it.name, it.sku ?? "", ...it.aliases].some((s) => s.toLowerCase().includes(q));
}

/** Counted minus expected, or null when the row has no count yet. */
export function countDiff(it: CountItem, counted: string | undefined): number | null {
  return counted?.trim() ? Number(counted) - it.expected : null;
}

export function sortCountRows(items: CountItem[], mode: NameMode, sort: CountSort, counts: Record<number, string>): CountItem[] {
  const label = (it: CountItem) => rowLabel(it, mode).text;
  const byLabel = (a: CountItem, b: CountItem) => label(a).localeCompare(label(b), undefined, { sensitivity: "base" });
  const miss = (it: CountItem) => Math.abs(countDiff(it, counts[it.id]) ?? 0);
  const cmp: Record<CountSort, (a: CountItem, b: CountItem) => number> = {
    "name": byLabel,
    "expected-desc": (a, b) => b.expected - a.expected || byLabel(a, b),
    "expected-asc": (a, b) => a.expected - b.expected || byLabel(a, b),
    "off-first": (a, b) => miss(b) - miss(a) || byLabel(a, b),
  };
  return [...items].sort(cmp[sort]);
}
