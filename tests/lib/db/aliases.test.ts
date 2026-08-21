import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias, removeAlias, resolveItemId, seenProductNames } from "@/lib/db/aliases";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { saveShow } from "@/lib/db/shows";

const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$2.00","L3","O3","Earnings for selling a Mystery Mini Dumpling #1","processing","SALES",""`;

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("alias resolver over item_identifiers", () => {
  it("setAlias stores a whatnot identifier resolvable by base name", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Highland Cow Squishy #3", id); // trailing #N stripped
    expect(resolveItemId(db, "Highland Cow Squishy")).toBe(id);
    const row = db.prepare("SELECT source, code FROM item_identifiers WHERE item_id = ? AND source = 'whatnot'").get(id);
    expect(row).toEqual({ source: "whatnot", code: "Highland Cow Squishy" });
  });

  it("resolveItemId also matches the item's own sku ('mine')", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const sku = (db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(id) as { sku: string }).sku;
    expect(resolveItemId(db, sku)).toBe(id);
  });

  it("setAlias re-points an existing name to a new item; removeAlias deletes it", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Shared", a);
    setAlias(db, "Shared", b);
    expect(resolveItemId(db, "Shared")).toBe(b);
    const rowId = (db.prepare("SELECT id FROM item_identifiers WHERE code = 'Shared'").get() as { id: number }).id;
    removeAlias(db, rowId);
    expect(resolveItemId(db, "Shared")).toBeNull();
  });
});

describe("seenProductNames", () => {
  it("lists distinct ledger sale product names with a mapped flag, unmapped first", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    saveLedger(db, parseLedger(CSV));
    const seen = seenProductNames(db);
    expect(seen).toEqual([
      { productName: "Mystery Mini Dumpling", mapped: false },
      { productName: "Cheese Squishy", mapped: true },
    ]);
  });

  it("dedupes a product that appears in both the ledger and a legacy show line (base name)", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    // Legacy show line stores the raw "#N" name.
    saveShow(db, {
      showDate: "2026-06-11", payoutCents: 0, shippingSuppliesCents: 0,
      giveawayCount: 0, giveawayUnitCents: 500, sourceHash: "h-dedupe",
      lines: [{ buyerUsername: "b", productName: "Cheese Squishy #3", quantity: 1, revenueCents: 300, status: "confirmed" }],
    });
    // Ledger stores the base name.
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #9","processing","SALES",""`));
    const seen = seenProductNames(db);
    expect(seen.filter((s) => s.productName === "Cheese Squishy")).toHaveLength(1);
    expect(seen).toEqual([{ productName: "Cheese Squishy", mapped: true }]);
  });

  it("orders multiple unmapped names alphabetically before mapped ones", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$2.00","L2","O2","Earnings for selling a Zebra Squishy #1","processing","SALES",""
"Jun 12, 2026, 10:12:00 AM","$2.00","L3","O3","Earnings for selling a Axolotl Squishy #1","processing","SALES",""`));
    const seen = seenProductNames(db);
    expect(seen.map((s) => s.productName)).toEqual(["Axolotl Squishy", "Zebra Squishy", "Cheese Squishy"]);
  });
});
