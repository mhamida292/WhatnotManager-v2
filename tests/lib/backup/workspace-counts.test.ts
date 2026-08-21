import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import { workspaceCounts } from "@/lib/backup/workbook";
import { insertItem } from "@/lib/db/inventory";

describe("workspaceCounts", () => {
  it("is empty for a fresh workspace apart from seeded settings", () => {
    const db = createDb(":memory:");
    const c = workspaceCounts(db);
    expect(c.inventory_items).toBeUndefined();
    expect(c.app_settings).toBe(1); // schema seeds the singleton row
  });

  it("counts rows per table and omits empty tables", () => {
    const db = createDb(":memory:");
    insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 3, lotId: null });
    const c = workspaceCounts(db);
    expect(c.inventory_items).toBe(1);
    expect(c.invoices).toBeUndefined();
  });
});
