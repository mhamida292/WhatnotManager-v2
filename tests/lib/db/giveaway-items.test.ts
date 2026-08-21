import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import {
  insertGiveawayItem, updateGiveawayItem, listGiveawayItems,
  getAllocations, setAllocations, giveawayItemUsageCount, deleteGiveawayItem,
} from "@/lib/db/giveaway-items";

describe("giveaway schema", () => {
  it("creates giveaway_items and show_giveaway_allocations tables", () => {
    const db = createDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((r) => r.name);
    expect(names).toContain("giveaway_items");
    expect(names).toContain("show_giveaway_allocations");
  });
});

describe("giveaway-items db module", () => {
  it("inserts and lists items, mapping columns to camelCase", () => {
    const db = createDb(":memory:");
    const id = insertGiveawayItem(db, { name: "Stickers", packCostCents: 999, packQty: 600 });
    const items = listGiveawayItems(db);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, name: "Stickers", packCostCents: 999, packQty: 600, active: true });
  });

  it("activeOnly excludes deactivated items", () => {
    const db = createDb(":memory:");
    const id = insertGiveawayItem(db, { name: "Old", packCostCents: 50, packQty: 1 });
    updateGiveawayItem(db, { id, name: "Old", packCostCents: 50, packQty: 1, active: false });
    expect(listGiveawayItems(db, { activeOnly: true })).toHaveLength(0);
    expect(listGiveawayItems(db)).toHaveLength(1);
  });

  it("setAllocations replaces the show's allocation rows", () => {
    const db = createDb(":memory:");
    const showId = Number(
      db.prepare("INSERT INTO shows (show_date) VALUES (?)").run("2026-06-21").lastInsertRowid
    );
    const sticker = insertGiveawayItem(db, { name: "Stickers", packCostCents: 999, packQty: 600 });
    const card = insertGiveawayItem(db, { name: "$5 card", packCostCents: 500, packQty: 1 });
    setAllocations(db, showId, [
      { giveawayItemId: sticker, count: 15 },
      { giveawayItemId: card, count: 2 },
    ]);
    expect(getAllocations(db, showId)).toEqual([
      { giveawayItemId: sticker, count: 15 },
      { giveawayItemId: card, count: 2 },
    ]);
    // replace, not append
    setAllocations(db, showId, [{ giveawayItemId: card, count: 1 }]);
    expect(getAllocations(db, showId)).toEqual([{ giveawayItemId: card, count: 1 }]);
  });

  it("deletes an unused item; reports usage for a referenced item", () => {
    const db = createDb(":memory:");
    const showId = Number(
      db.prepare("INSERT INTO shows (show_date) VALUES (?)").run("2026-06-21").lastInsertRowid
    );
    const unused = insertGiveawayItem(db, { name: "Dupe", packCostCents: 999, packQty: 1 });
    const used = insertGiveawayItem(db, { name: "Card", packCostCents: 500, packQty: 1 });
    setAllocations(db, showId, [{ giveawayItemId: used, count: 2 }]);

    expect(giveawayItemUsageCount(db, unused)).toBe(0);
    expect(giveawayItemUsageCount(db, used)).toBe(1);

    deleteGiveawayItem(db, unused);
    expect(listGiveawayItems(db).map((i) => i.id)).toEqual([used]);
  });
});
