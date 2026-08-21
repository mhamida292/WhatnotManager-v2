import { avgPerUnitCents } from "./avg-per-unit";

export type SortDir = "asc" | "desc";
export type SortKey =
  | "productName" | "qty" | "unitCostCents" | "costCents"
  | "revenueCents" | "avgPerUnit" | "profitCents";

export interface SortableProduct {
  productName: string;
  qty: number;
  unitCostCents: number | null;
  costCents: number;
  revenueCents: number;
  profitCents: number;
}

/** Sort value for a row; null means "always sort last". */
function valueOf(p: SortableProduct, key: SortKey): string | number | null {
  switch (key) {
    case "productName": return p.productName;
    case "qty": return p.qty;
    case "unitCostCents": return p.unitCostCents;
    case "costCents": return p.costCents;
    case "revenueCents": return p.revenueCents;
    case "profitCents": return p.profitCents;
    case "avgPerUnit": return avgPerUnitCents(p.revenueCents, p.qty);
  }
}

/** Returns a new array sorted by `key`/`dir`. Null values always go to the end. */
export function sortProducts<T extends SortableProduct>(products: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...products].sort((a, b) => {
    const va = valueOf(a, key);
    const vb = valueOf(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;   // nulls last, regardless of dir
    if (vb === null) return -1;
    if (typeof va === "string" && typeof vb === "string") return sign * va.localeCompare(vb);
    return sign * ((va as number) - (vb as number));
  });
}
