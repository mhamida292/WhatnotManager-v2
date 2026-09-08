import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDb, type DB } from "@/lib/db/connection";
import { listDismissedNames } from "@/lib/db/dismissed-names";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ dbForRequest: async () => getDb() }));

const { POST, DELETE } = await import("@/app/api/aliases/dismiss/route");

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  getDb.mockReturnValue(db);
});

const call = (fn: typeof POST, body: unknown) =>
  fn(new NextRequest("http://test/api/aliases/dismiss", { method: "POST", body: JSON.stringify(body) }));

describe("/api/aliases/dismiss", () => {
  it("dismisses a name", async () => {
    const res = await call(POST, { productName: "BUNDLE ON SCREEN" });
    expect(res.status).toBe(200);
    expect(listDismissedNames(db).map((d) => d.code)).toEqual(["BUNDLE ON SCREEN"]);
  });

  it("restores a name", async () => {
    await call(POST, { productName: "BUNDLE ON SCREEN" });
    const res = await call(DELETE, { productName: "BUNDLE ON SCREEN" });
    expect(res.status).toBe(200);
    expect(listDismissedNames(db)).toEqual([]);
  });

  it("rejects a missing or blank name rather than writing an empty code", async () => {
    expect((await call(POST, {})).status).toBe(400);
    expect((await call(POST, { productName: "   " })).status).toBe(400);
    expect(listDismissedNames(db)).toEqual([]);
  });
});
