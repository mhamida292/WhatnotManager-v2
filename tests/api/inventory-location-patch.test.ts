import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, listItems, setItemLocation } from "@/lib/db/inventory";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("inventory location patch path", () => {
  it("trims and stores a location, empty string clears it", () => {
    const id = createItemWithFirstPurchase(db, { name: "Box", lotId: null, purchasedOn: null, quantity: 1, unitCostCents: 50 });
    setItemLocation(db, id, "  Zone B / Shelf 4  ");
    expect(listItems(db).find((i) => i.id === id)?.location).toBe("Zone B / Shelf 4");
    setItemLocation(db, id, "");
    expect(listItems(db).find((i) => i.id === id)?.location).toBeNull();
  });
});
