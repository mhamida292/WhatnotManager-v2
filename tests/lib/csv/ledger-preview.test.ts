import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { buildLedgerPreview } from "@/lib/csv/ledger-preview";

const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$2.00","L3","O3","Earnings for selling a Mystery Mini Dumpling #1","processing","SALES",""
"Jun 12, 2026, 10:14:56 AM","-$0.78","L2","O2","Charged deduction of $0.78 for giveaway order zzz","completed","SALES","x"`;

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("buildLedgerPreview", () => {
  it("groups by date with computed payout and lists unmapped products", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    const out = buildLedgerPreview(db, CSV);

    expect(out.shows).toHaveLength(1);
    const day = out.shows[0];
    expect(day.showDate).toBe("2026-06-12");
    expect(day.payoutCents).toBe(49 + 200 - 78);
    expect(day.saleCount).toBe(2);
    expect(day.giveawayCount).toBe(1);
    expect(out.unmapped).toContain("Mystery Mini Dumpling");
    expect(out.unmapped).not.toContain("Cheese Squishy");
  });

  it("sorts shows ascending by date and counts tip/bonus/other kinds", () => {
    const CSV2 = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 10, 2026, 12:00:41 AM","$400.00","","","New Seller Sales Match Bonus","completed","ADJUSTMENT","x"
"Jun 8, 2026, 10:55:32 PM","$1.00","","","Received a tip from snorke","completed","TIP","y"
"Jun 8, 2026, 09:00:00 PM","$0.00","","","Some unrecognized ledger line","completed","WEIRD","z"`;
    const out = buildLedgerPreview(db, CSV2);
    expect(out.shows.map((s) => s.showDate)).toEqual(["2026-06-08", "2026-06-10", "2026-06-12"]);
    const jun8 = out.shows.find((s) => s.showDate === "2026-06-08")!;
    expect(jun8.tipCount).toBe(1);
    expect(jun8.otherCount).toBe(1);
    const jun10 = out.shows.find((s) => s.showDate === "2026-06-10")!;
    expect(jun10.bonusCount).toBe(1);
    expect(jun10.payoutCents).toBe(40000);
  });

  it("counts PAYOUT rows as payoutCount and keeps them out of otherCount", () => {
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank account","completed","PAYOUT","b"`;
    const prev = buildLedgerPreview(db, csv);
    const show = prev.shows.find((s) => s.showDate === "2026-06-14")!;
    expect(show.payoutCount).toBe(1);
    expect(show.otherCount).toBe(0);
  });

  it("excludes PAYOUT withdrawals from the preview payoutCents", () => {
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank account","completed","PAYOUT","b"`;
    const prev = buildLedgerPreview(db, csv);
    const show = prev.shows.find((s) => s.showDate === "2026-06-14")!;
    expect(show.payoutCents).toBe(10000);
  });
});
