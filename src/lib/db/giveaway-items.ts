import type { DB } from "./connection";

export interface GiveawayItem {
  id: number;
  name: string;
  packCostCents: number;
  packQty: number;
  active: boolean;
}

export interface Allocation {
  giveawayItemId: number;
  count: number;
}

interface ItemRow {
  id: number; name: string; packCostCents: number; packQty: number; active: number;
}

export function listGiveawayItems(db: DB, opts: { activeOnly?: boolean } = {}): GiveawayItem[] {
  const where = opts.activeOnly ? "WHERE active = 1" : "";
  const rows = db.prepare(
    `SELECT id, name, pack_cost_cents AS packCostCents, pack_qty AS packQty, active
     FROM giveaway_items ${where} ORDER BY name`
  ).all() as ItemRow[];
  return rows.map((r) => ({ ...r, active: r.active === 1 }));
}

export function insertGiveawayItem(
  db: DB,
  i: { name: string; packCostCents: number; packQty: number }
): number {
  const info = db.prepare(
    "INSERT INTO giveaway_items (name, pack_cost_cents, pack_qty) VALUES (?,?,?)"
  ).run(i.name, i.packCostCents, i.packQty);
  return Number(info.lastInsertRowid);
}

export function updateGiveawayItem(
  db: DB,
  i: { id: number; name: string; packCostCents: number; packQty: number; active: boolean }
): void {
  db.prepare(
    "UPDATE giveaway_items SET name = ?, pack_cost_cents = ?, pack_qty = ?, active = ? WHERE id = ?"
  ).run(i.name, i.packCostCents, i.packQty, i.active ? 1 : 0, i.id);
}

/** Number of show allocations that reference this giveaway item. */
export function giveawayItemUsageCount(db: DB, id: number): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM show_giveaway_allocations WHERE giveaway_item_id = ?"
  ).get(id) as { c: number };
  return row.c;
}

/** Hard-delete a giveaway item. Caller must ensure it is unused
 *  (giveawayItemUsageCount === 0); deleting a referenced item would orphan
 *  past shows' allocations, so the API guards against it. */
export function deleteGiveawayItem(db: DB, id: number): void {
  db.prepare("DELETE FROM giveaway_items WHERE id = ?").run(id);
}

export function getAllocations(db: DB, showId: number): Allocation[] {
  return db.prepare(
    `SELECT giveaway_item_id AS giveawayItemId, count
     FROM show_giveaway_allocations WHERE show_id = ? ORDER BY id`
  ).all(showId) as Allocation[];
}

export function setAllocations(db: DB, showId: number, allocations: Allocation[]): void {
  const tx = db.transaction((rows: Allocation[]) => {
    db.prepare("DELETE FROM show_giveaway_allocations WHERE show_id = ?").run(showId);
    const ins = db.prepare(
      "INSERT INTO show_giveaway_allocations (show_id, giveaway_item_id, count) VALUES (?,?,?)"
    );
    for (const r of rows) ins.run(showId, r.giveawayItemId, r.count);
  });
  tx(allocations);
}
