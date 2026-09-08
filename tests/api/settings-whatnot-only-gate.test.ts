import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { getSettings } from "@/lib/db/settings";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ dbForRequest: async () => getDb() }));

const { PUT } = await import("@/app/api/settings/route");

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  getDb.mockReturnValue(db);
});

const baseBody = { defaultShippingSuppliesCents: 0 };

function putSettings(body: Record<string, unknown>) {
  const req = new NextRequest("http://test/api/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return PUT(req);
}

describe("PUT /api/settings — whatnot-only gate", () => {
  it("off -> on with warehouse stock present is blocked with 409 naming the blocking item(s)", async () => {
    const id = insertItem(db, { name: "Blue Widget", unitCostCents: 100, qtyPurchased: 5, lotId: null });

    const res = await putSettings({ ...baseBody, whatnotOnly: true });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.items).toEqual([{ id, name: "Blue Widget", qty: 5 }]);
    expect(getSettings(db).whatnotOnly).toBe(false);
  });

  it("off -> on with a clean (all-zero) warehouse succeeds", async () => {
    const res = await putSettings({ ...baseBody, whatnotOnly: true });

    expect(res.status).toBe(200);
    expect(getSettings(db).whatnotOnly).toBe(true);
  });

  it("already on, PUT omitting whatnotOnly entirely leaves it on", async () => {
    await putSettings({ ...baseBody, whatnotOnly: true });

    const res = await putSettings({ ...baseBody });

    expect(res.status).toBe(200);
    expect(getSettings(db).whatnotOnly).toBe(true);
  });

  it("on -> off explicitly succeeds, never gated, even with warehouse stock present", async () => {
    await putSettings({ ...baseBody, whatnotOnly: true });
    insertItem(db, { name: "New Stock", unitCostCents: 100, qtyPurchased: 3, lotId: null });

    const res = await putSettings({ ...baseBody, whatnotOnly: false });

    expect(res.status).toBe(200);
    expect(getSettings(db).whatnotOnly).toBe(false);
  });
});
