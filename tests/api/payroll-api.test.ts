import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDb, type DB } from "@/lib/db/connection";
import { listPayroll } from "@/lib/db/payroll";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ dbForRequest: async () => getDb() }));

const { POST } = await import("@/app/api/payroll/route");
const { PATCH } = await import("@/app/api/payroll/[id]/route");

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  getDb.mockReturnValue(db);
});

const body = (over: Record<string, unknown> = {}) => ({
  person: "Sam", workDate: "2026-07-08", startTime: "20:00", endTime: "01:00",
  rateCents: 1500, note: null, ...over,
});

const post = (b: Record<string, unknown>) =>
  POST(new NextRequest("http://test/api/payroll", { method: "POST", body: JSON.stringify(b) }));

const patch = (id: number, b: Record<string, unknown>) =>
  PATCH(new NextRequest(`http://test/api/payroll/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
        { params: Promise.resolve({ id: String(id) }) });

describe("POST /api/payroll", () => {
  it("derives hours and amount from the clock times", async () => {
    const res = await post(body());
    expect(res.status).toBe(200);

    const [row] = listPayroll(db);
    expect(row.hours).toBe(5);            // 20:00 -> 01:00 crosses midnight
    expect(row.amountCents).toBe(7500);   // 5h * $15
    expect(row.workDate).toBe("2026-07-08");
  });

  it("ignores a client-supplied amount and recomputes it", async () => {
    await post(body({ amountCents: 999999, hours: 99 }));
    const [row] = listPayroll(db);
    expect(row.amountCents).toBe(7500);
    expect(row.hours).toBe(5);
  });

  it("rejects equal start and end rather than reading it as 24 hours", async () => {
    const res = await post(body({ startTime: "12:00", endTime: "12:00" }));
    expect(res.status).toBe(400);
    expect(listPayroll(db)).toHaveLength(0);
  });

  it("rejects malformed times, a missing person, and a non-positive rate", async () => {
    expect((await post(body({ endTime: "nope" }))).status).toBe(400);
    expect((await post(body({ person: "   " }))).status).toBe(400);
    expect((await post(body({ rateCents: 0 }))).status).toBe(400);
    expect((await post(body({ workDate: "07/08/2026" }))).status).toBe(400);
    expect(listPayroll(db)).toHaveLength(0);
  });
});

describe("PATCH /api/payroll/[id]", () => {
  it("updates a shift and re-derives hours and amount", async () => {
    await post(body());
    const id = listPayroll(db)[0].id;

    const res = await patch(id, body({ startTime: "18:00", endTime: "23:00", rateCents: 2000 }));
    expect(res.status).toBe(200);

    const [row] = listPayroll(db);
    expect(row.hours).toBe(5);
    expect(row.amountCents).toBe(10000);
  });

  it("404s an unknown id and validates like POST", async () => {
    expect((await patch(999, body())).status).toBe(404);
    await post(body());
    const id = listPayroll(db)[0].id;
    expect((await patch(id, body({ rateCents: -5 }))).status).toBe(400);
  });
});
