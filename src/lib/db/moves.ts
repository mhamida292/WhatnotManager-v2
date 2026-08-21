import type { DB } from "./connection";
import { getSettings } from "./settings";

export type MoveDirection = "to_whatnot" | "to_warehouse";
export interface Move {
  id: number; itemId: number; movedOn: string | null; qty: number; direction: MoveDirection; note: string | null;
}

export function addMove(db: DB, m: { itemId: number; qty: number; direction: MoveDirection; movedOn?: string | null; note?: string | null }): number {
  if (!Number.isInteger(m.qty) || m.qty < 1) throw new Error("move qty must be a positive integer");
  const info = db.prepare(
    "INSERT INTO inventory_moves (item_id, moved_on, qty, direction, note) VALUES (?,?,?,?,?)"
  ).run(m.itemId, m.movedOn ?? null, m.qty, m.direction, m.note ?? null);
  return Number(info.lastInsertRowid);
}

export function listMoves(db: DB, itemId: number): Move[] {
  return db.prepare(
    "SELECT id, item_id AS itemId, moved_on AS movedOn, qty, direction, note FROM inventory_moves WHERE item_id = ? ORDER BY moved_on, id"
  ).all(itemId) as Move[];
}

function sumDir(db: DB, itemId: number, direction: MoveDirection): number {
  const r = db.prepare("SELECT COALESCE(SUM(qty),0) AS s FROM inventory_moves WHERE item_id = ? AND direction = ?").get(itemId, direction) as { s: number };
  return Number(r.s);
}
export const movedToWhatnot = (db: DB, itemId: number) => sumDir(db, itemId, "to_whatnot");
export const movedToWarehouse = (db: DB, itemId: number) => sumDir(db, itemId, "to_warehouse");

/** While Whatnot-only mode is on, keep the Warehouse bucket pinned at 0 by
 *  writing a compensating move. A no-op when the mode is off, so every call
 *  site can call it unconditionally. */
export function settleWhatnotOnly(db: DB, itemId: number, qty: number, direction: MoveDirection): void {
  if (qty <= 0) return;
  if (!getSettings(db).whatnotOnly) return;
  addMove(db, { itemId, qty, direction, note: "auto (Whatnot-only)" });
}
