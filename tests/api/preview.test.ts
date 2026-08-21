import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { buildPreview } from "@/lib/csv/preview";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

const CSV = `buyer_username,product_name,product_quantity,original_item_price,cancelled_or_failed,shipment_id
bob,Cheese Squishy #1,1,3.0,,ship1
x,AMAZON $5 GIFTCARD GIVVY #1,1,0,,ship2
y,Mystery Mini Dumpling #1,1,2.0,,ship3`;

describe("buildPreview", () => {
  it("classifies rows and reports unmapped product names", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    const out = buildPreview(db, CSV);
    expect(out.rows).toHaveLength(3);
    expect(out.rows.find((r) => r.productName.startsWith("Cheese"))!.status).toBe("confirmed");
    expect(out.unmapped).toContain("Mystery Mini Dumpling");
    expect(out.unmapped).not.toContain("Cheese Squishy");
  });
});
