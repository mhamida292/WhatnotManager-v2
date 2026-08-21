import type { DB } from "@/lib/db/connection";
import { listAllPurchases } from "@/lib/db/purchases";
import { listLedgerTransactions } from "@/lib/db/ledger";
import { ledgerTimeOfDaySeconds } from "@/lib/csv/ledger";
import type { AvgMethod } from "@/lib/db/settings";

export interface PoolCostResult {
  currentAvgUnitCostCents: number;
  totalUnitsPurchased: number;
  totalSpendCents: number;
  totalSaleCount: number;
  costBySaleTxnId: Map<number, number>;
}

/** Whole-pool weighted-average cost, for workspaces where a sale can't be
 *  attributed to a specific SKU (Whatnot's "Item On Screen" format). Both
 *  methods are pure and recomputed live — no stored derived state, matching
 *  how the rest of the app resolves cost (docs/calculations.md). */
export function computePoolCost(db: DB, avgMethod: AvgMethod): PoolCostResult {
  const purchases = listAllPurchases(db);
  const sales = listLedgerTransactions(db).filter((t) => t.kind === "sale");

  const totalUnitsPurchased = purchases.reduce((s, p) => s + p.quantity, 0);
  const totalSpendCents = purchases.reduce((s, p) => s + p.quantity * p.unitCostCents, 0);
  const totalSaleCount = sales.length;

  if (avgMethod === "live") {
    const avg = totalUnitsPurchased > 0 ? Math.round(totalSpendCents / totalUnitsPurchased) : 0;
    const costBySaleTxnId = new Map(sales.map((s) => [s.id, avg]));
    return { currentAvgUnitCostCents: avg, totalUnitsPurchased, totalSpendCents, totalSaleCount, costBySaleTxnId };
  }

  // Moving average (AVCO): merge purchases and sales into one chronological
  // timeline and walk it, locking each sale's cost at that moment's average.
  // Same-day: purchases apply before sales. Purchase dates are day-only
  // (no time component); sale ordering within a day uses time-of-day.
  type PurchaseEvent = { kind: "purchase"; date: string; id: number; quantity: number; unitCostCents: number };
  type SaleEvent = { kind: "sale"; date: string; timeSeconds: number; id: number };
  const events: (PurchaseEvent | SaleEvent)[] = [
    ...purchases.map((p): PurchaseEvent => ({ kind: "purchase", date: p.purchasedOn ?? "", id: p.id, quantity: p.quantity, unitCostCents: p.unitCostCents })),
    ...sales.map((s): SaleEvent => ({ kind: "sale", date: s.showDate, timeSeconds: ledgerTimeOfDaySeconds(s.createdAt), id: s.id })),
  ];
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "purchase" ? -1 : 1;
    if (a.kind === "sale" && b.kind === "sale") return a.timeSeconds - b.timeSeconds || a.id - b.id;
    return a.id - b.id;
  });

  let runningUnits = 0;
  let runningValueCents = 0;
  const costBySaleTxnId = new Map<number, number>();
  for (const e of events) {
    if (e.kind === "purchase") {
      runningUnits += e.quantity;
      runningValueCents += e.quantity * e.unitCostCents;
    } else {
      const avg = runningUnits > 0 ? Math.round(runningValueCents / runningUnits) : 0;
      costBySaleTxnId.set(e.id, avg);
      runningValueCents -= avg;
      runningUnits -= 1;
    }
  }
  const currentAvgUnitCostCents = runningUnits > 0 ? Math.round(runningValueCents / runningUnits) : 0;
  return { currentAvgUnitCostCents, totalUnitsPurchased, totalSpendCents, totalSaleCount, costBySaleTxnId };
}
