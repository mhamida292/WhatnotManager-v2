import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Token set by whichever test is currently running; the mocked cookies() reads it.
let token: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => (token ? { value: token } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));

let dir: string;
let prevDataDir: string | undefined;

beforeAll(() => {
  prevDataDir = process.env.DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), "db-for-request-"));
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  const { closeAllDbs } = await import("@/lib/db/connection");
  closeAllDbs();
  rmSync(dir, { recursive: true, force: true });
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
});

describe("dbForRequest", () => {
  it("routes each logged-in user to their own workspace db, not a shared one", async () => {
    const { getUsersDb, appSecret } = await import("@/lib/auth/users-db");
    const { createUser } = await import("@/lib/auth/users");
    const { signSession } = await import("@/lib/auth/session");
    const { getDb } = await import("@/lib/db/connection");
    const { dbForRequest } = await import("@/lib/auth/request");

    const reg = getUsersDb();
    const userAId = createUser(reg, { username: "alice", password: "hunter2", isAdmin: false });
    const userBId = createUser(reg, { username: "bob", password: "hunter2", isAdmin: false });
    const secret = appSecret(reg);

    token = signSession(userAId, secret);
    const dbA = await dbForRequest();
    expect(dbA).toBe(getDb(userAId));
    expect(dbA).not.toBe(getDb(userBId));

    token = signSession(userBId, secret);
    const dbB = await dbForRequest();
    expect(dbB).toBe(getDb(userBId));
    expect(dbB).not.toBe(dbA);
  });
});
