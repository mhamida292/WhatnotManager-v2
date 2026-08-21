import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { computePoolCost } from "@/lib/calc/pool-cost";

let db: DB;
let itemId: number;
beforeEach(() => {
  db = createDb(":memory:");
  itemId = insertItem(db, { name: "Dummy", unitCostCents: 0, qtyPurchased: 0, lotId: null });
});

const SALE = (date: string, id: string) =>
  `"${date}","$12.00","L${id}","O${id}","Earnings for selling a Item On Screen #${id}","processing","SALES",""`;

function saleCsv(rows: string[]): string {
  return `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"\n${rows.join("\n")}`;
}

describe("computePoolCost — live method", () => {
  it("returns $0 avg with no purchases", () => {
    const result = computePoolCost(db, "live");
    expect(result.currentAvgUnitCostCents).toBe(0);
    expect(result.totalUnitsPurchased).toBe(0);
  });

  it("applies one all-time blended average to every sale, regardless of purchase order", () => {
    addPurchase(db, { itemId, purchasedOn: "2026-01-01", quantity: 10, unitCostCents: 200 });
    saveLedger(db, parseLedger(saleCsv([
      SALE("Jan 15, 2026, 10:00:00 AM", "1"),
      SALE("Jan 15, 2026, 10:01:00 AM", "2"),
      SALE("Jan 15, 2026, 10:02:00 AM", "3"),
      SALE("Jan 15, 2026, 10:03:00 AM", "4"),
    ])));
    addPurchase(db, { itemId, purchasedOn: "2026-02-01", quantity: 10, unitCostCents: 400 });

    const result = computePoolCost(db, "live");
    expect(result.totalUnitsPurchased).toBe(20);
    expect(result.totalSpendCents).toBe(6000);
    expect(result.totalSaleCount).toBe(4);
    expect(result.currentAvgUnitCostCents).toBe(300); // (2000+4000)/20
    // Even the January sales cost $3.00 once Feb's purchase is folded into the all-time average.
    expect([...result.costBySaleTxnId.values()]).toEqual([300, 300, 300, 300]);
  });
});

describe("computePoolCost — moving average (AVCO)", () => {
  it("costs a sale at $0 when it happens before any purchase exists", () => {
    saveLedger(db, parseLedger(saleCsv([SALE("Jan 1, 2026, 09:00:00 AM", "1")])));
    const result = computePoolCost(db, "moving");
    expect([...result.costBySaleTxnId.values()]).toEqual([0]);
    expect(result.currentAvgUnitCostCents).toBe(0);
  });

  it("applies a same-day purchase before that day's sales", () => {
    addPurchase(db, { itemId, purchasedOn: "2026-03-01", quantity: 5, unitCostCents: 100 });
    saveLedger(db, parseLedger(saleCsv([SALE("Mar 1, 2026, 09:00:00 AM", "1")])));
    const result = computePoolCost(db, "moving");
    expect([...result.costBySaleTxnId.values()]).toEqual([100]);
  });

  it("locks each sale's cost at that moment's average; a later purchase never restates it", () => {
    addPurchase(db, { itemId, purchasedOn: "2026-01-01", quantity: 10, unitCostCents: 200 });
    saveLedger(db, parseLedger(saleCsv([
      SALE("Jan 15, 2026, 10:00:00 AM", "1"),
      SALE("Jan 15, 2026, 10:01:00 AM", "2"),
      SALE("Jan 15, 2026, 10:02:00 AM", "3"),
      SALE("Jan 15, 2026, 10:03:00 AM", "4"),
    ])));
    addPurchase(db, { itemId, purchasedOn: "2026-02-01", quantity: 10, unitCostCents: 400 });

    const result = computePoolCost(db, "moving");
    // All 4 January sales are locked at $2.00 — the pre-Feb average — forever.
    expect([...result.costBySaleTxnId.values()]).toEqual([200, 200, 200, 200]);
    // Current average reflects what's left: (10*200 - 4*200 + 10*400) / (10-4+10) = 5200/16.
    expect(result.currentAvgUnitCostCents).toBe(325);
    expect(result.totalUnitsPurchased).toBe(20);
    expect(result.totalSpendCents).toBe(6000);
  });
});
