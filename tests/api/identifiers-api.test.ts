import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, identifiersForItem, setSku } from "@/lib/db/inventory";
import { addIdentifier, removeAlias } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("identifiers api (data layer)", () => {
  it("add then remove a supplier identifier", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const r = addIdentifier(db, { itemId: id, source: "supplier", code: "ACME-2" });
    expect(r.ok).toBe(true);
    const before = identifiersForItem(db, id).length;
    removeAlias(db, (r as { ok: true; id: number }).id);
    expect(identifiersForItem(db, id).length).toBe(before - 1);
  });

  it("mine identifier is identifiable so the route can refuse to delete it", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const mine = identifiersForItem(db, id).find((r) => r.source === "mine")!;
    expect(mine.source).toBe("mine"); // route checks this before removeAlias
  });
});
