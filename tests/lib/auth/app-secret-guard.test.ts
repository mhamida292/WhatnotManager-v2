import { describe, it, expect, afterEach } from "vitest";
import { openUsersDb, appSecret, PLACEHOLDER_APP_SECRET } from "@/lib/auth/users-db";

afterEach(() => { delete process.env.APP_SECRET; });

describe("appSecret guard", () => {
  it("rejects the docker-compose placeholder instead of signing sessions with it", () => {
    process.env.APP_SECRET = PLACEHOLDER_APP_SECRET;
    const db = openUsersDb(":memory:");
    expect(() => appSecret(db)).toThrow(/APP_SECRET/);
  });

  it("rejects a secret too short to be a real random value", () => {
    process.env.APP_SECRET = "hunter2";
    const db = openUsersDb(":memory:");
    expect(() => appSecret(db)).toThrow(/APP_SECRET/);
  });

  it("does not fall back to the persisted secret when the env value is bad", () => {
    const db = openUsersDb(":memory:");
    delete process.env.APP_SECRET;
    const persisted = appSecret(db); // seed a persisted secret first
    process.env.APP_SECRET = PLACEHOLDER_APP_SECRET;
    // A silent fallback would hand back `persisted` and hide the misconfiguration.
    expect(() => appSecret(db)).toThrow();
    expect(persisted.length).toBeGreaterThan(20);
  });

  it("accepts a proper secret", () => {
    process.env.APP_SECRET = "a".repeat(64);
    const db = openUsersDb(":memory:");
    expect(appSecret(db)).toBe("a".repeat(64));
  });
});
