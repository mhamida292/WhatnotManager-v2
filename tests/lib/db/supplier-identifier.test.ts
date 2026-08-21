import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias, resolveItemId } from "@/lib/db/aliases";
import { recordSupplierIdentifier } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("recordSupplierIdentifier", () => {
  it("writes a supplier identifier that then resolves to the item", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const wrote = recordSupplierIdentifier(db, "ACME-4471", id);
    expect(wrote).toBe(true);
    expect(resolveItemId(db, "ACME-4471")).toBe(id);
    const row = db.prepare("SELECT source FROM item_identifiers WHERE code = 'ACME-4471'").get() as { source: string };
    expect(row.source).toBe("supplier");
  });

  it("is a no-op (returns true) when the code already points at the same item", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    recordSupplierIdentifier(db, "ACME-4471", id);
    const again = recordSupplierIdentifier(db, "ACME-4471", id);
    expect(again).toBe(true);
    const n = db.prepare("SELECT COUNT(*) n FROM item_identifiers WHERE code = 'ACME-4471'").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("does NOT steal a code owned by a different item (returns false, leaves it)", () => {
    const a = insertItem(db, { name: "Item A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "Item B", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Shared Name", a); // a whatnot identifier owns this code, → item a
    const wrote = recordSupplierIdentifier(db, "Shared Name", b);
    expect(wrote).toBe(false);
    expect(resolveItemId(db, "Shared Name")).toBe(a); // unchanged
  });
});
