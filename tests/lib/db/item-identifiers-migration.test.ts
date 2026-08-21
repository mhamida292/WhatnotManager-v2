import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createDb } from "@/lib/db/connection";

/** Build a DB shaped like the OLD schema (product_aliases, no sku/identifiers),
 *  seed an item + alias, then reopen through createDb to trigger migration. */
function legacyDbFile(): string {
  const path = `/tmp/uii-mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const raw = new Database(path);
  raw.exec(`
    CREATE TABLE inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      unit_cost_cents INTEGER NOT NULL, qty_purchased INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE product_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT NOT NULL UNIQUE,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id));
    INSERT INTO inventory_items (id, name, unit_cost_cents, qty_purchased) VALUES (1,'Highland Cow',200,10);
    INSERT INTO product_aliases (product_name, item_id) VALUES ('Highland Cow Squishy',1);
    INSERT INTO product_aliases (product_name, item_id) VALUES ('Cow Plush',1);
  `);
  raw.close();
  return path;
}

describe("item_identifiers migration", () => {
  it("adds sku, seeds a 'mine' identifier, and copies aliases to 'whatnot'", () => {
    const db = createDb(legacyDbFile());

    const item = db.prepare("SELECT sku FROM inventory_items WHERE id = 1").get() as { sku: string };
    expect(item.sku).toBeTruthy();

    const rows = db.prepare(
      "SELECT source, code FROM item_identifiers WHERE item_id = 1 ORDER BY source, code"
    ).all() as { source: string; code: string }[];
    expect(rows).toEqual([
      { source: "mine", code: item.sku },
      { source: "whatnot", code: "Cow Plush" },
      { source: "whatnot", code: "Highland Cow Squishy" },
    ]);

    const hasOld = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='product_aliases'"
    ).get();
    expect(hasOld).toBeUndefined();
  });

  it("is idempotent (re-opening the same file does not duplicate identifiers)", () => {
    const path = legacyDbFile();
    createDb(path).close();
    const db2 = createDb(path);
    const n = db2.prepare("SELECT COUNT(*) n FROM item_identifiers WHERE item_id = 1").get() as { n: number };
    expect(n.n).toBe(3);
  });

  it("aborts (throws) rather than silently dropping an alias that collides with a generated sku", () => {
    // legacy DB: item id 1 gets generated sku ITEM-00001; an alias named 'ITEM-00001'
    // collides with the 'mine' identifier seeded before the whatnot copy runs.
    const path = `/tmp/uii-mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        unit_cost_cents INTEGER NOT NULL, qty_purchased INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE product_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT NOT NULL UNIQUE,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id));
      INSERT INTO inventory_items (id, name, unit_cost_cents, qty_purchased) VALUES (1,'Highland Cow',200,10);
      INSERT INTO product_aliases (product_name, item_id) VALUES ('ITEM-00001',1);
      INSERT INTO product_aliases (product_name, item_id) VALUES ('Normal Name',1);
    `);
    raw.close();

    expect(() => createDb(path)).toThrow(/would lose .* code collision/);
  });
});
