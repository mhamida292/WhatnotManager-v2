import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv/parse";

const SAMPLE = `order_id,buyer_username,product_name,product_quantity,original_item_price,cancelled_or_failed,shipment_id,gifted_to
abc,bradley543,Cheese Squishy #1,1,3.0,,387292926,
xyz,ariarod71890,Highland Cow Squishy (Assorted Colors)  #2,1,3.0,cancelled,,`;

describe("parseCsv", () => {
  it("parses rows with the columns we use", () => {
    const rows = parseCsv(SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      buyerUsername: "bradley543",
      productName: "Cheese Squishy #1",
      quantity: 1,
      priceCents: 300,
      cancelledOrFailed: "",
      shipmentId: "387292926",
    });
    expect(rows[1].cancelledOrFailed).toBe("cancelled");
    expect(rows[1].shipmentId).toBe("");
  });
  it("tolerates missing optional columns", () => {
    const rows = parseCsv("buyer_username,product_name,product_quantity,original_item_price\nu,Item,2,1.5");
    expect(rows[0]).toMatchObject({ buyerUsername: "u", quantity: 2, priceCents: 150, shipmentId: "" });
  });
});
