import { describe, it, expect } from "vitest";
import { openUsersDb, appSecret } from "@/lib/auth/users-db";

describe("users registry", () => {
  it("creates the users + app_meta tables", () => {
    const db = openUsersDb(":memory:");
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
    expect(tables).toContain("users");
    expect(tables).toContain("app_meta");
  });
  it("returns a stable persisted secret when APP_SECRET is unset", () => {
    delete process.env.APP_SECRET;
    const db = openUsersDb(":memory:");
    const s1 = appSecret(db);
    expect(s1.length).toBeGreaterThan(20);
    expect(appSecret(db)).toBe(s1); // stable across calls
  });
});
