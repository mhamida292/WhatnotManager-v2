import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, listItems, setItemLocation } from "@/lib/db/inventory";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("inventory location", () => {
  it("defaults location to null and can set it", () => {
    const id = createItemWithFirstPurchase(db, { name: "Widget", lotId: null, purchasedOn: null, quantity: 5, unitCostCents: 100 });
    expect(listItems(db).find((i) => i.id === id)?.location).toBeNull();
    setItemLocation(db, id, "A3-2");
    expect(listItems(db).find((i) => i.id === id)?.location).toBe("A3-2");
    setItemLocation(db, id, null);
    expect(listItems(db).find((i) => i.id === id)?.location).toBeNull();
  });
});
