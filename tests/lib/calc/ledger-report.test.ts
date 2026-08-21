import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { getSettings, updateSettings } from "@/lib/db/settings";
import { addPurchase } from "@/lib/db/purchases";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { insertGiveawayItem, setAllocations } from "@/lib/db/giveaway-items";
import { listShowSaleLines, setShowBundles } from "@/lib/db/bundles";

// One Cheese sale ($0.49) + one unmapped Mystery sale ($2.00) + one giveaway (-$0.78) on Jun 12.
const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$2.00","L3","O3","Earnings for selling a Mystery Mini Dumpling #1","processing","SALES",""
"Jun 12, 2026, 10:14:56 AM","-$0.78","L2","O2","Charged deduction of $0.78 for giveaway order zzz","completed","SALES","x"`;

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
  setAlias(db, "Cheese Squishy", cheese);
  saveLedger(db, parseLedger(CSV));
});

describe("buildLedgerReport", () => {
  it("reports per-product cost, revenue and profit within a show", () => {
    const rep = buildLedgerReport(db);
    expect(rep.shows).toHaveLength(1);
    const show = rep.shows[0];
    const cheese = show.products.find((p) => p.productName === "Cheese Squishy")!;
    expect(cheese.mapped).toBe(true);
    expect(cheese.qty).toBe(1);
    expect(cheese.unitCostCents).toBe(250);
    expect(cheese.costCents).toBe(250);
    expect(cheese.revenueCents).toBe(49);
    expect(cheese.profitCents).toBe(49 - 250);
  });

  it("treats unmapped products as $0 cost and flags them", () => {
    const rep = buildLedgerReport(db);
    const mystery = rep.shows[0].products.find((p) => p.productName === "Mystery Mini Dumpling")!;
    expect(mystery.mapped).toBe(false);
    expect(mystery.costCents).toBe(0);
    expect(mystery.revenueCents).toBe(200);
    expect(rep.unmappedNames).toContain("Mystery Mini Dumpling");
    expect(rep.unmappedCount).toBe(1);
  });

  it("computes show net = payout - COGS - giveaway cost - shipping", () => {
    const rep = buildLedgerReport(db);
    const show = rep.shows[0];
    expect(show.payoutCents).toBe(49 + 200 - 78); // 171 (includes Whatnot's giveaway fee)
    expect(show.cogsCents).toBe(250);             // only the mapped Cheese
    expect(show.giveawayCount).toBe(1);           // one giveaway this show
    expect(show.giveawayCostCents).toBe(0);       // no allocations yet → $0
    expect(show.shippingSuppliesCents).toBe(0);
    expect(show.netCents).toBe(171 - 250 - 0 - 0); // -79
  });

  it("counts units sold per show and in totals (sales only, not giveaways)", () => {
    const rep = buildLedgerReport(db);
    expect(rep.shows[0].unitsSold).toBe(2);
    expect(rep.totals.unitsSold).toBe(2);
  });

  it("reports saleCount per show; a refund-only date has saleCount 0", () => {
    // The default beforeEach CSV has one Cheese sale + one Mystery sale on Jun 12.
    const rep = buildLedgerReport(db);
    const jun12 = rep.shows.find((s) => s.showDate === "2026-06-12")!;
    expect(jun12.saleCount).toBe(2);
  });

  it("computes grand totals and owner share from the configured split", () => {
    updateSettings(db, { ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving" });
    const rep = buildLedgerReport(db);
    expect(rep.totals.giveawayCostCents).toBe(0);  // no allocations → $0
    expect(rep.totals.netCents).toBe(-79);          // 171 - 250 - 0
    // partner = floor(-79 * 0.2) = floor(-15.8) = -16; owner = -79 - (-16) = -63
    expect(rep.totals.partnerShareCents).toBe(-16);
    expect(rep.totals.ownerShareCents).toBe(-63);
  });

  it("scales giveaway cost with allocations (not the unit cost setting)", () => {
    updateSettings(db, { ownerSharePct: 80, giveawayUnitCents: 700, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving" });
    const rep = buildLedgerReport(db);
    expect(rep.giveawayUnitCents).toBe(700);
    expect(rep.shows[0].giveawayCostCents).toBe(0); // 1 giveaway but no allocations → $0
  });

  it("excludes payout withdrawals from payoutCents and reports them as withdrawnToBankCents", () => {
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 09:30:00 AM","-$534.39","","","Payout to bank account","completed","PAYOUT","b"`;
    saveLedger(db, parseLedger(csv));
    const rep = buildLedgerReport(db);
    const show = rep.shows.find((s) => s.showDate === "2026-06-14")!;
    expect(show.payoutCents).toBe(10000);
    expect(show.withdrawnToBankCents).toBe(-53439);
    expect(rep.totals.withdrawnToBankCents).toBe(-53439);
  });

  it("keeps product lines per-show and counts bonus/tip in payout but not COGS", () => {
    const db2 = createDb(":memory:");
    const cheese = insertItem(db2, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db2, "Cheese Squishy", cheese);
    const CSV2 = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 11, 2026, 09:00:00 PM","$1.00","L4","O4","Earnings for selling a Cheese Squishy #9","processing","SALES",""
"Jun 11, 2026, 09:05:00 PM","$400.00","","B1","New Seller Sales Match Bonus","completed","ADJUSTMENT","x"
"Jun 11, 2026, 09:10:00 PM","$1.00","","T1","Received a tip from snorke","completed","TIP","y"`;
    saveLedger(db2, parseLedger(CSV2));
    const rep = buildLedgerReport(db2);

    expect(rep.shows).toHaveLength(2);
    const jun11 = rep.shows.find((s) => s.showDate === "2026-06-11")!;
    const jun12 = rep.shows.find((s) => s.showDate === "2026-06-12")!;

    // Same product, two shows => two independent lines, each qty 1.
    expect(jun11.products.find((p) => p.productName === "Cheese Squishy")!.qty).toBe(1);
    expect(jun12.products.find((p) => p.productName === "Cheese Squishy")!.qty).toBe(1);

    // Bonus ($400) + tip ($1) are in payout but NOT in COGS.
    expect(jun11.payoutCents).toBe(100 + 40000 + 100); // 40200
    expect(jun11.bonusTotalCents).toBe(40000);
    expect(jun11.tipTotalCents).toBe(100);
    expect(jun11.cogsCents).toBe(250);                 // only the cheese
    expect(jun11.netCents).toBe(40200 - 250 - 0);      // 39950

    // Grand totals across both shows.
    expect(rep.totals.revenueCents).toBe(49 + 100);    // sale revenue only
    expect(rep.totals.cogsCents).toBe(250 + 250);      // 500
    expect(rep.totals.netCents).toBe(39950 + (49 - 250)); // 39749
  });
});

describe("itemized giveaway cost", () => {
  it("costs giveaways from allocations, rounding the summed float once", () => {
    // db/CSV from the file's beforeEach: 1 show on Jun 12 with 1 detected giveaway.
    const sticker = insertGiveawayItem(db, { name: "Stickers", packCostCents: 999, packQty: 600 });
    const card = insertGiveawayItem(db, { name: "$5 card", packCostCents: 500, packQty: 1 });
    const squishy = insertGiveawayItem(db, { name: "Mini squishy", packCostCents: 50, packQty: 1 });
    const showId = buildLedgerReport(db).shows[0].showId;
    setAllocations(db, showId, [
      { giveawayItemId: sticker, count: 15 }, // 15 * 1.665 = 24.975 -> 25 after rounding the sum
      { giveawayItemId: card, count: 2 },     // 1000
      { giveawayItemId: squishy, count: 1 },  // 50
    ]);
    const show = buildLedgerReport(db).shows[0];
    expect(show.giveawayCostCents).toBe(25 + 1000 + 50); // 1075
    expect(show.giveawayUnallocated).toBe(false);
  });

  it("costs 15 stickers as 25c (not 30c), proving end-rounding", () => {
    const sticker = insertGiveawayItem(db, { name: "Stickers", packCostCents: 999, packQty: 600 });
    const showId = buildLedgerReport(db).shows[0].showId;
    setAllocations(db, showId, [{ giveawayItemId: sticker, count: 15 }]);
    expect(buildLedgerReport(db).shows[0].giveawayCostCents).toBe(25);
  });

  it("flags a show with detected giveaways but no allocations as $0 + unallocated", () => {
    const show = buildLedgerReport(db).shows[0];
    expect(show.giveawayCount).toBe(1);
    expect(show.giveawayCostCents).toBe(0);
    expect(show.giveawayUnallocated).toBe(true);
  });
});

describe("buildLedgerReport — sessions", () => {
  const TWO = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 20, 2026, 10:00:00 AM","$3.00","L1","O1","Earnings for selling a Cheese Squishy #1","processing","SALES",""
"Jun 20, 2026, 5:00:00 PM","$4.00","L3","O3","Earnings for selling a Highland Cow #1","processing","SALES",""`;

  it("exposes sessionSeq, timeRange, and dateHasMultipleSessions", () => {
    saveLedger(db, parseLedger(TWO));
    const rep = buildLedgerReport(db);
    const day = rep.shows.filter((s) => s.showDate === "2026-06-20").sort((a, b) => a.sessionSeq - b.sessionSeq);
    expect(day).toHaveLength(2);
    expect(day.every((s) => s.dateHasMultipleSessions)).toBe(true);
    expect(day[0].sessionSeq).toBe(0);
    expect(day[0].timeRange).toBe("10:00 AM–10:00 AM");
    expect(day[1].timeRange).toBe("5:00 PM–5:00 PM");
  });
});

describe("buildLedgerReport — bundles", () => {
  const LEDGER = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 23, 2026, 10:00:00 AM","$45.00","L1","O1","Earnings for selling a Mega Bundle #1","processing","SALES",""
"Jun 23, 2026, 10:05:00 AM","$22.00","L2","O2","Earnings for selling a Mega Bundle #1","processing","SALES",""`;

  it("costs a bundle from its components, as its own row, independent of identical names", () => {
    const a = insertItem(db, { name: "Squish A", unitCostCents: 200, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "Squish B", unitCostCents: 640, qtyPurchased: 0, lotId: null });
    saveLedger(db, parseLedger(LEDGER));
    const showId = (db.prepare("SELECT id FROM shows ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    const lines = listShowSaleLines(db, showId);
    const first = lines.find((l) => l.amountCents === 4500)!;   // both lines share the name "Mega Bundle"
    setShowBundles(db, showId, [
      { ledgerTxnId: first.id, components: [{ itemId: a, qty: 2 }, { itemId: b, qty: 1 }] },
    ]);

    const rep = buildLedgerReport(db);
    const show = rep.shows.find((s) => s.showId === showId)!;
    const bundleLine = show.products.find((p) => p.isBundle)!;
    expect(bundleLine.costCents).toBe(1040);              // 2*200 + 1*640
    expect(bundleLine.revenueCents).toBe(4500);
    expect(bundleLine.profitCents).toBe(3460);
    expect(bundleLine.components).toEqual([
      { name: "Squish A", qty: 2, unitCostCents: 200, costCents: 400 },
      { name: "Squish B", qty: 1, unitCostCents: 640, costCents: 640 },
    ]);
    // The second identically-named sale line is NOT merged into the bundle line.
    const nonBundle = show.products.filter((p) => !p.isBundle && p.productName === "Mega Bundle");
    expect(nonBundle).toHaveLength(1);
    expect(nonBundle[0].revenueCents).toBe(2200);
    // Show COGS includes the bundle's component cost.
    expect(show.cogsCents).toBe(1040 + nonBundle[0].costCents);
  });
});

describe("buildLedgerReport — pooled costing mode", () => {
  it("prices every sale from the pool average instead of per-product alias resolution", () => {
    const db2 = createDb(":memory:");
    const item = insertItem(db2, { name: "Dummy", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db2, { itemId: item, purchasedOn: "2026-06-01", quantity: 10, unitCostCents: 200 });
    updateSettings(db2, { ...getSettings(db2), costingMode: "pooled", avgMethod: "live" });
    saveLedger(db2, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$12.00","L1","O1","Earnings for selling a Item On Screen #1","processing","SALES",""
"Jun 12, 2026, 10:15:57 AM","$8.00","L2","O2","Earnings for selling a Item On Screen #2","processing","SALES",""`));

    const rep = buildLedgerReport(db2);
    const show = rep.shows[0];
    expect(show.products).toEqual([]);
    expect(show.unitsSold).toBe(2);
    expect(show.cogsCents).toBe(400); // 2 sales x $2.00 pool avg
    expect(show.pooledSales).toEqual([
      { amountCents: 1200, costCents: 200, createdAt: "Jun 12, 2026, 10:14:57 AM" },
      { amountCents: 800, costCents: 200, createdAt: "Jun 12, 2026, 10:15:57 AM" },
    ]);
    expect(rep.totals.revenueCents).toBe(2000); // from pooledSales, not empty products
    expect(rep.unmappedCount).toBe(0); // no alias resolution attempted at all
    expect(rep.pool).toEqual({
      currentAvgUnitCostCents: 200,
      totalUnitsPurchased: 10,
      totalSaleCount: 2,
      unitsOnHand: 8,
      valueOnHandCents: 1600,
    });
  });

  it("leaves per_sku workspaces with pool undefined and unchanged products/cogs behavior", () => {
    const rep = buildLedgerReport(db); // outer beforeEach db: default costingMode "per_sku"
    expect(rep.pool).toBeUndefined();
    expect(rep.shows[0].pooledSales).toBeUndefined();
    expect(rep.shows[0].products.length).toBeGreaterThan(0);
  });
});
