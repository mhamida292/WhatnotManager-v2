import type { DB } from "./connection";
import { getSettings } from "./settings";

export type AdjustReason = "sample" | "damage_loss" | "recount" | "other";
export interface Adjustment { id: number; itemId: number; adjustedOn: string | null; reason: AdjustReason; qty: number; note: string | null; counted: number | null; }

export function listAdjustments(db: DB, itemId: number): Adjustment[] {
  return db.prepare(
    "SELECT id, item_id AS itemId, adjusted_on AS adjustedOn, reason, qty, note, counted FROM inventory_adjustments WHERE item_id = ? ORDER BY adjusted_on, id"
  ).all(itemId) as Adjustment[];
}

export function addAdjustment(db: DB, a: { itemId: number; adjustedOn: string | null; reason: AdjustReason; qty: number; note: string | null; counted?: number | null; channel?: "warehouse" | "whatnot" | null }): number {
  const channel = getSettings(db).whatnotOnly ? "whatnot" : (a.channel ?? null);
  const info = db.prepare(
    "INSERT INTO inventory_adjustments (item_id, adjusted_on, reason, qty, note, counted, channel) VALUES (?,?,?,?,?,?,?)"
  ).run(a.itemId, a.adjustedOn, a.reason, a.qty, a.note, a.counted ?? null, channel);
  return Number(info.lastInsertRowid);
}

export function deleteAdjustment(db: DB, id: number): void {
  db.prepare("DELETE FROM inventory_adjustments WHERE id = ?").run(id);
}

export function sumAdjustments(db: DB, itemId: number): number {
  const r = db.prepare("SELECT COALESCE(SUM(qty),0) AS s FROM inventory_adjustments WHERE item_id = ?").get(itemId) as { s: number };
  return Number(r.s);
}

/** Sum of adjustment qty on the Whatnot channel only. NULL channel counts as warehouse. */
export function sumWhatnotAdjustments(db: DB, itemId: number): number {
  const r = db.prepare("SELECT COALESCE(SUM(qty),0) AS s FROM inventory_adjustments WHERE item_id = ? AND channel = 'whatnot'").get(itemId) as { s: number };
  return Number(r.s);
}
