import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { addIdentifier, resolveItemId, setAlias } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("addIdentifier", () => {
  it("adds a supplier identifier that resolves to the item", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const r = addIdentifier(db, { itemId: id, source: "supplier", code: "ACME-9", supplierLabel: "Acme" });
    expect(r.ok).toBe(true);
    expect(resolveItemId(db, "ACME-9")).toBe(id);
  });

  it("rejects a code already owned by a different item as duplicate", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Taken", a);
    const r = addIdentifier(db, { itemId: b, source: "whatnot", code: "Taken" });
    expect(r).toEqual({ ok: false, reason: "duplicate" });
    expect(resolveItemId(db, "Taken")).toBe(a); // unchanged
  });

  it("rejects an empty code", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    expect(addIdentifier(db, { itemId: id, source: "supplier", code: "   " })).toEqual({ ok: false, reason: "empty" });
  });
});
