import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mirrors the mocking convention in tests/api/settings-whatnot-only-gate.test.ts:
// mock the auth entry point the route imports from, rather than reaching into cookies/sessions.
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ requireAdmin: () => requireAdmin() }));

const { DELETE } = await import("@/app/api/admin/users/[id]/route");

let dir: string;
let prevDataDir: string | undefined;

beforeAll(() => {
  prevDataDir = process.env.DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), "admin-users-delete-"));
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  const { closeAllDbs } = await import("@/lib/db/connection");
  closeAllDbs();
  rmSync(dir, { recursive: true, force: true });
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
});

function del(id: number) {
  const req = new NextRequest(`http://test/api/admin/users/${id}`, { method: "DELETE" });
  return DELETE(req, { params: Promise.resolve({ id: String(id) }) });
}

describe("DELETE /api/admin/users/:id", () => {
  it("removes the registry row but leaves the user's workspace file on disk", async () => {
    const { getUsersDb } = await import("@/lib/auth/users-db");
    const { createUser, getUserById } = await import("@/lib/auth/users");
    const { getDb, workspacePath } = await import("@/lib/db/connection");
    const { insertExpense } = await import("@/lib/db/expenses");

    const reg = getUsersDb();
    const admin = createUser(reg, { username: "admin", password: "hunter2", isAdmin: true });
    const victimId = createUser(reg, { username: "victim", password: "hunter2", isAdmin: false });
    requireAdmin.mockResolvedValue({ id: admin, username: "admin", is_admin: 1, created_at: "" });

    // Materialize the victim's workspace with real data so the file exists on disk.
    const victimDb = getDb(victimId);
    insertExpense(victimDb, { description: "keep me", type: "one_time", amountCents: 500, incurredOn: "2026-06-24" });
    expect(existsSync(workspacePath(victimId))).toBe(true);

    const res = await del(victimId);

    expect(res.status).toBe(200);
    expect(getUserById(reg, victimId)).toBeUndefined();
    expect(existsSync(workspacePath(victimId))).toBe(true);
  });
});
