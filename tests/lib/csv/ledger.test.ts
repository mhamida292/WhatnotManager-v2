import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLedger, ledgerShowDate, parseAmountCents, extractSaleNumber, unrecognizedPayoutMessage } from "@/lib/csv/ledger";

describe("extractSaleNumber", () => {
  it("pulls the trailing #N sequence number from a sale message", () => {
    expect(extractSaleNumber("Earnings for selling a On Screen Bundle! ✨🎁 #10")).toBe("10");
    expect(extractSaleNumber("Earnings for selling a Slow-Rise Dino Squishy 🦖✨ #1")).toBe("1");
  });
  it("returns null when there is no trailing #N", () => {
    expect(extractSaleNumber("Charged deduction of $0.00 for giveaway order LSiA9vXyz")).toBeNull();
    expect(extractSaleNumber("Earnings for selling a Mystery Squishy")).toBeNull();
  });
});

const csv = readFileSync(resolve(__dirname, "../../fixtures/sample-ledger.csv"), "utf8");

describe("parseLedger", () => {
  const rows = parseLedger(csv);

  it("parses every row", () => {
    expect(rows).toHaveLength(5);
  });

  it("parses signed amounts to cents", () => {
    expect(rows[0].amountCents).toBe(49);
    expect(rows[2].amountCents).toBe(-78);
    expect(rows[3].amountCents).toBe(40000);
  });

  it("derives a timezone-safe calendar show date from the created date", () => {
    expect(rows[0].showDate).toBe("2026-06-12");
    expect(rows[3].showDate).toBe("2026-06-10");
    expect(rows[4].showDate).toBe("2026-06-08");
  });

  it("classifies kinds", () => {
    expect(rows[0].kind).toBe("sale");
    expect(rows[2].kind).toBe("giveaway");
    expect(rows[3].kind).toBe("bonus");
    expect(rows[4].kind).toBe("tip");
  });

  it("extracts the base product name for sales only", () => {
    expect(rows[0].productName).toBe("Highland Cow Squishy (Assorted Colors)");
    expect(rows[3].productName).toBeNull();
  });

  it("builds a stable dedup key", () => {
    const again = parseLedger(csv);
    expect(again[0].dedupKey).toBe(rows[0].dedupKey);
    expect(new Set(rows.map((r) => r.dedupKey)).size).toBe(5);
  });

  it("classifies a PAYOUT (bank withdrawal) as kind 'payout'", () => {
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","-$534.39","","","Payout to bank account","completed","PAYOUT","z"`;
    const rows = parseLedger(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("payout");
    expect(rows[0].amountCents).toBe(-53439);
  });
});

describe("refund classification", () => {
  const csv = (msg: string, type: string) =>
    `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jul 6, 2026, 5:16:52 PM","-$6.44","L1","O1","${msg}","completed","${type}",""`;
  it("classifies ADJUSTMENT refund reversals and shipping deductions as refund", () => {
    expect(parseLedger(csv("Reversal of sales transaction for order refund", "ADJUSTMENT"))[0].kind).toBe("refund");
    expect(parseLedger(csv("Deduction for order refund shipping costs [Order Id: 1]", "ADJUSTMENT"))[0].kind).toBe("refund");
  });
  it("still classifies Sales Match Bonus and other adjustments correctly", () => {
    expect(parseLedger(csv("New Seller Sales Match Bonus", "ADJUSTMENT"))[0].kind).toBe("bonus");
    expect(parseLedger(csv("Seller purchased Show Boost for ...", "ADJUSTMENT"))[0].kind).toBe("other");
    expect(parseLedger(csv("Approved Insurance Claim for shipment 1", "ADJUSTMENT"))[0].kind).toBe("other");
  });
});

describe("payout failure classification", () => {
  const row = (msg: string, amount: string) =>
    `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Sep 7, 2026, 4:42:20 AM","${amount}","","","${msg}","completed","ADJUSTMENT",""`;

  it("reads a payout failure refund as a payout-line event, not revenue", () => {
    // Whatnot never marks the original PAYOUT as failed -- it stays 'completed'
    // and the money comes back days later as this ADJUSTMENT. Classifying it as
    // 'payout' cancels the withdrawal instead of booking a second sale.
    const r = parseLedger(row("Payout failure refund for 1318550423", "$13,723.07"))[0];
    expect(r.kind).toBe("payout");
    expect(r.amountCents).toBe(1372307);
  });

  it("wins over the generic refund match, whose word it contains", () => {
    expect(parseLedger(row("Payout Failure Refund for 99", "$1.00"))[0].kind).toBe("payout");
  });

  it("leaves ordinary order refunds alone", () => {
    expect(parseLedger(row("Reversal of sales transaction for order refund", "-$6.44"))[0].kind).toBe("refund");
  });

  it("flags an unrecognized payout-ish adjustment instead of silently banking it", () => {
    expect(unrecognizedPayoutMessage("ADJUSTMENT", "Payout reversal for 123")).toBe(true);
    expect(unrecognizedPayoutMessage("ADJUSTMENT", "Payout failure refund for 1")).toBe(false);
    expect(unrecognizedPayoutMessage("ADJUSTMENT", "Reversal of sales transaction for order refund")).toBe(false);
    expect(unrecognizedPayoutMessage("SALES", "Earnings for selling a payout themed mug")).toBe(false);
  });
});

describe("ledgerShowDate / parseAmountCents guards", () => {
  it("returns empty string for unparseable or unknown-month dates", () => {
    expect(ledgerShowDate("")).toBe("");
    expect(ledgerShowDate("garbage")).toBe("");
    expect(ledgerShowDate("Xyz 1, 2026, 10:00:00 AM")).toBe("");
  });
  it("parses normal and thousands-separated amounts; empty -> 0", () => {
    expect(parseAmountCents("$1,234.56")).toBe(123456);
    expect(parseAmountCents("")).toBe(0);
    expect(parseAmountCents("-$0.78")).toBe(-78);
  });
});
