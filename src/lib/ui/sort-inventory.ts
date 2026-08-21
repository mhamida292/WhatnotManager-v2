export type InvSortKey =
  | "name" | "unitCostCents" | "qtyPurchased" | "sold" | "remaining" | "warehouse" | "whatnot";
export type SortDir = "asc" | "desc";

export interface SortableItem {
  name: string;
  unitCostCents: number;
  qtyPurchased: number;
  sold: number;
  remaining: number;
  warehouse: number;
  whatnot: number;
}

/** Stable sort by the given column. Strings compare case-insensitively,
 *  numbers numerically. Returns a new array; input is not mutated. */
export function sortInventory<T extends SortableItem>(items: T[], key: InvSortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = a[key], bv = b[key];
    const cmp = typeof av === "string"
      ? (av as string).localeCompare(bv as string, undefined, { sensitivity: "base" })
      : (av as number) - (bv as number);
    return cmp * sign;
  });
}
