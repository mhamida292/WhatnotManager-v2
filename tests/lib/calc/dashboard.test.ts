import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, insertLot } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { setAlias } from "@/lib/db/aliases";
import { insertExpense } from "@/lib/db/expenses";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { dashboardSummary } from "@/lib/calc/dashboard";
import { updateSettings } from "@/lib/db/settings";
import { createInvoice, addInvoiceLine, postInvoice, setInvoicePaid } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

const SALE = (msg: string, amount: string, id: string) =>
  `"Jun 12, 2026, 10:14:57 AM","${amount}","L${id}","O${id}","${msg}","processing","SALES",""`;

describe("dashboardSummary", () => {
  it("aggregates net profit (incl. ledger COGS), owner share, inventory spend, expenses", () => {
    const lot = insertLot(db, { name: "Lot 1", totalCostCents: 73200 });
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: lot });
    addPurchase(db, { itemId: cheese, purchasedOn: null, quantity: 20, unitCostCents: 250 });
    setAlias(db, "Cheese Squishy", cheese);
    // One mapped Cheese sale for $12.00 -> payout 1200, cogs 250, net 950.
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
${SALE("Earnings for selling a Cheese Squishy #3", "$12.00", "1")}`));
    insertExpense(db, { description: "Boxes", type: "one_time", amountCents: 500 });

    const d = dashboardSummary(db);
    expect(d.grossSalesCents).toBe(1200);               // sale earnings before any costs
    expect(d.totalPayoutCents).toBe(1200);              // only a sale here, so payout == sales
    expect(d.totalNetProfitCents).toBe(950);            // 1200 payout - 250 cogs
    expect(d.partnerShareCents).toBe(190);              // floor(950 * 0.2)
    expect(d.ownerShareCents).toBe(760);
    expect(d.netInventorySpendCents).toBe(5000);        // 250 unit cost x 20 purchased
    expect(d.totalExpensesCents).toBe(500);
  });

  it("matches the ledger report and applies the configured owner share percentage", () => {
    // One UNMAPPED sale for $10.00 -> payout 1000, cogs 0, net 1000.
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
${SALE("Earnings for selling a Mystery Dumpling #1", "$10.00", "9")}`));
    updateSettings(db, { ownerSharePct: 70, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving" });

    const d = dashboardSummary(db);
    expect(d.totalNetProfitCents).toBe(1000);
    expect(d.partnerShareCents).toBe(300);              // floor(1000 * 0.3)
    expect(d.ownerShareCents).toBe(700);
  });

  it("excludes bonuses from gross sales but includes them in total payout", () => {
    const BONUS = (amount: string, id: string) =>
      `"Jun 12, 2026, 11:00:00 AM","${amount}","","O${id}","Sales Match Bonus","processing","ADJUSTMENT",""`;
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
${SALE("Earnings for selling a Mystery Dumpling #1", "$10.00", "9")}
${BONUS("$400.00", "b1")}`));

    const d = dashboardSummary(db);
    expect(d.grossSalesCents).toBe(1000);               // sale earnings only — bonus excluded
    expect(d.totalPayoutCents).toBe(41000);             // 1000 sale + 40000 bonus
  });

  it("reports paidToBankCents and keeps withdrawals out of totalPayout", () => {
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank account","completed","PAYOUT","b"`;
    saveLedger(db, parseLedger(csv));
    const d = dashboardSummary(db);
    expect(d.totalPayoutCents).toBe(10000);
    expect(d.paidToBankCents).toBe(53439); // positive amount moved to bank
  });
});

describe("dashboardSummary — wholesale-inclusive headline totals", () => {
  it("includes PAID wholesale revenue and profit in grossSalesCents and totalNetProfitCents", () => {
    const item = insertItem(db, { name: "Pack", unitCostCents: 175, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: item, purchasedOn: null, quantity: 100, unitCostCents: 175 });

    // Paid invoice: 10 units @ $3.00 -> revenue 3000, cogs 10×175=1750, profit 1250
    const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: 10, unitCostCents: 0, unitPriceCents: 300 });
    postInvoice(db, id);
    setInvoicePaid(db, id, true, "2026-06-28");

    const d = dashboardSummary(db);
    expect(d.grossSalesCents).toBe(3000);     // 10 × 300
    expect(d.totalNetProfitCents).toBe(1250); // 3000 − 1750
  });

  it("excludes UNPAID posted wholesale from headline totals; only paid counts", () => {
    const item = insertItem(db, { name: "Pack", unitCostCents: 175, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: item, purchasedOn: null, quantity: 100, unitCostCents: 175 });

    // Paid invoice: 10 units @ $3.00 -> revenue 3000, profit 1250
    const paid = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: paid, itemId: item, productName: "Pack", quantity: 10, unitCostCents: 0, unitPriceCents: 300 });
    postInvoice(db, paid);
    setInvoicePaid(db, paid, true, "2026-06-28");

    // Unpaid posted invoice: 5 units @ $3.00 -> owed 1500, must NOT appear in totals
    const unpaid = createInvoice(db, { direction: "sale", customer: "Jane", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: unpaid, itemId: item, productName: "Pack", quantity: 5, unitCostCents: 0, unitPriceCents: 300 });
    postInvoice(db, unpaid);
    // deliberately not paid

    const d = dashboardSummary(db);
    // Totals must reflect ONLY the paid invoice
    expect(d.grossSalesCents).toBe(3000);     // 10 × 300 (unpaid 1500 excluded)
    expect(d.totalNetProfitCents).toBe(1250); // paid profit only
  });
});
