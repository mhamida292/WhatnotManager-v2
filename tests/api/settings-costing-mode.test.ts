import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDb, type DB } from "@/lib/db/connection";
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
  const req = new NextRequest("http://test/api/settings", { method: "PUT", body: JSON.stringify(body) });
  return PUT(req);
}

describe("PUT /api/settings — costing mode", () => {
  it("defaults to per_sku/moving and persists an explicit change to pooled/live", async () => {
    expect(getSettings(db).costingMode).toBe("per_sku");

    const res = await putSettings({ ...baseBody, costingMode: "pooled", avgMethod: "live" });

    expect(res.status).toBe(200);
    expect(getSettings(db).costingMode).toBe("pooled");
    expect(getSettings(db).avgMethod).toBe("live");
  });

  it("omitting costingMode/avgMethod leaves the current values untouched", async () => {
    await putSettings({ ...baseBody, costingMode: "pooled", avgMethod: "live" });

    const res = await putSettings({ ...baseBody });

    expect(res.status).toBe(200);
    expect(getSettings(db).costingMode).toBe("pooled");
    expect(getSettings(db).avgMethod).toBe("live");
  });

  it("rejects an invalid costingMode/avgMethod value by falling back to the current setting", async () => {
    const res = await putSettings({ ...baseBody, costingMode: "not_a_mode" });

    expect(res.status).toBe(200);
    expect(getSettings(db).costingMode).toBe("per_sku"); // invalid value ignored, default kept
  });
});
