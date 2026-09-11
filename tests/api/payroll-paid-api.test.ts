import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDb, type DB } from "@/lib/db/connection";
import { insertPayroll, listPayroll } from "@/lib/db/payroll";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ dbForRequest: async () => getDb() }));

const { PATCH } = await import("@/app/api/payroll/[id]/paid/route");

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  getDb.mockReturnValue(db);
});

const entry = () => insertPayroll(db, {
  person: "Ahmed", workDate: "2026-09-09", basis: "piece", qty: 300,
  startTime: null, endTime: null, rateCents: 15, amountCents: 4500, note: null,
});

const patch = (id: number, b: Record<string, unknown>) =>
  PATCH(new NextRequest(`http://test/api/payroll/${id}/paid`, { method: "PATCH", body: JSON.stringify(b) }),
        { params: Promise.resolve({ id: String(id) }) });

describe("PATCH /api/payroll/[id]/paid", () => {
  it("stamps and clears the paid date", async () => {
    const id = entry();
    expect((await patch(id, { paidOn: "2026-09-12" })).status).toBe(200);
    expect(listPayroll(db)[0].paidOn).toBe("2026-09-12");

    expect((await patch(id, { paidOn: null })).status).toBe(200);
    expect(listPayroll(db)[0].paidOn).toBeNull();
  });

  it("leaves the amount alone", async () => {
    const id = entry();
    await patch(id, { paidOn: "2026-09-12" });
    expect(listPayroll(db)[0].amountCents).toBe(4500);
  });

  it("rejects a malformed date and 404s an unknown id", async () => {
    const id = entry();
    expect((await patch(id, { paidOn: "09/12/2026" })).status).toBe(400);
    expect(listPayroll(db)[0].paidOn).toBeNull();
    expect((await patch(999, { paidOn: "2026-09-12" })).status).toBe(404);
  });
});
