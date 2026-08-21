import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase } from "@/lib/db/inventory";
import { getSettings, updateSettings } from "@/lib/db/settings";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ dbForRequest: async () => getDb() }));

const { POST } = await import("@/app/api/inventory/move/route");

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  getDb.mockReturnValue(db);
});

function postMove(body: Record<string, unknown>) {
  const req = new NextRequest("http://test/api/inventory/move", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/inventory/move — whatnot-only gate", () => {
  it("returns 409 while whatnot-only mode is on", async () => {
    const id = createItemWithFirstPurchase(db, { name: "W", lotId: null, purchasedOn: null, quantity: 50, unitCostCents: 100 });
    updateSettings(db, { ...getSettings(db), whatnotOnly: true });

    const res = await postMove({ itemId: id, quantity: 5, direction: "to_whatnot" });

    expect(res.status).toBe(409);
  });
});
