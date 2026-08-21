import { describe, it, expect } from "vitest";
import { classifyRows, baseProductName } from "@/lib/csv/classify";
import type { RawRow } from "@/lib/csv/types";

function row(p: Partial<RawRow>): RawRow {
  return { buyerUsername: "u", productName: "Item #1", quantity: 1, priceCents: 300,
    cancelledOrFailed: "", shipmentId: "ship1", giftedTo: "", ...p };
}

describe("classifyRows", () => {
  it("confirmed when shipment present and not cancelled", () => {
    expect(classifyRows([row({})])[0].status).toBe("confirmed");
  });
  it("cancelled and failed from the cancelled_or_failed column", () => {
    expect(classifyRows([row({ cancelledOrFailed: "cancelled", shipmentId: "" })])[0].status).toBe("cancelled");
    expect(classifyRows([row({ cancelledOrFailed: "failed", shipmentId: "" })])[0].status).toBe("failed");
  });
  it("giveaway when product name contains GIFTCARD GIVVY", () => {
    expect(classifyRows([row({ productName: "AMAZON $5 GIFTCARD GIVVY #3", priceCents: 0 })])[0].status).toBe("giveaway");
  });
  it("flags suspected duplicate: same buyer + product base + price within show", () => {
    const rows = [
      row({ buyerUsername: "bob", productName: "Cheese Squishy #1", priceCents: 300 }),
      row({ buyerUsername: "bob", productName: "Cheese Squishy #5", priceCents: 300 }),
    ];
    const out = classifyRows(rows);
    expect(out[0].status).toBe("confirmed");
    expect(out[1].status).toBe("suspected_duplicate");
  });
  it("does not flag duplicate when price differs", () => {
    const rows = [
      row({ buyerUsername: "bob", productName: "Cheese Squishy #1", priceCents: 300 }),
      row({ buyerUsername: "bob", productName: "Cheese Squishy #5", priceCents: 500 }),
    ];
    expect(classifyRows(rows).every((r) => r.status === "confirmed")).toBe(true);
  });
  it("cancelled when no shipment id and no flag", () => {
    expect(classifyRows([row({ shipmentId: "", cancelledOrFailed: "" })])[0].status).toBe("cancelled");
  });
});

describe("baseProductName", () => {
  it("baseProductName strips the trailing #N (and double spaces)", () => {
    expect(baseProductName("Highland Cow Squishy (Assorted Colors)  #2")).toBe("Highland Cow Squishy (Assorted Colors)");
    expect(baseProductName("Cheese Squishy #1")).toBe("Cheese Squishy");
  });
});
