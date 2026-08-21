import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, qtyRemaining } from "@/lib/db/inventory";
import { addAdjustment, listAdjustments, deleteAdjustment, sumAdjustments } from "@/lib/db/adjustments";
import { addPurchase } from "@/lib/db/purchases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

it("adjustments reduce/raise remaining and sum correctly", () => {
  const a = insertItem(db, { name: "A", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: a, purchasedOn: null, quantity: 100, unitCostCents: 50 });
  addAdjustment(db, { itemId: a, adjustedOn: "2026-06-12", reason: "sample", qty: -2, note: null });
  addAdjustment(db, { itemId: a, adjustedOn: "2026-06-18", reason: "damage_loss", qty: -4, note: "crushed" });
  expect(sumAdjustments(db, a)).toBe(-6);
  expect(qtyRemaining(db, a)).toBe(94);          // 100 - 0 sold - 6
  expect(listAdjustments(db, a)).toHaveLength(2);
});

it("deleteAdjustment restores remaining", () => {
  const a = insertItem(db, { name: "A", unitCostCents: 0, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: a, purchasedOn: null, quantity: 10, unitCostCents: 0 });
  const id = addAdjustment(db, { itemId: a, adjustedOn: null, reason: "recount", qty: -3, note: null });
  expect(qtyRemaining(db, a)).toBe(7);
  deleteAdjustment(db, id);
  expect(qtyRemaining(db, a)).toBe(10);
});

describe("adjustments counted column", () => {
  it("stores and returns counted alongside the delta", () => {
    const itemId = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 50, lotId: null });
    addAdjustment(db, { itemId, adjustedOn: "2026-07-04", reason: "recount", qty: -3, note: null, counted: 40 });
    const rows = listAdjustments(db, itemId);
    expect(rows[0]).toMatchObject({ qty: -3, counted: 40, reason: "recount" });
  });
  it("defaults counted to null when omitted, and does not affect sumAdjustments", () => {
    const itemId = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 50, lotId: null });
    addAdjustment(db, { itemId, adjustedOn: "2026-07-04", reason: "damage_loss", qty: -2, note: null });
    const rows = listAdjustments(db, itemId);
    expect(rows[0].counted).toBeNull();
    expect(sumAdjustments(db, itemId)).toBe(-2);
  });
});
