import { describe, it, expect, beforeEach } from "vitest";
import { openUsersDb } from "@/lib/auth/users-db";
import { createUser, verifyLogin, listUsers, resetPassword, deleteUser, countUsers, adminExists, getUserById } from "@/lib/auth/users";
import type { DB } from "@/lib/db/connection";

let db: DB;
beforeEach(() => { db = openUsersDb(":memory:"); });

describe("user crud", () => {
  it("creates, lists, and authenticates a user", () => {
    const id = createUser(db, { username: "sam", password: "pw", isAdmin: false });
    expect(countUsers(db)).toBe(1);
    expect(listUsers(db)[0].username).toBe("sam");
    expect(getUserById(db, id)?.username).toBe("sam");
    expect(verifyLogin(db, "sam", "pw")?.id).toBe(id);
    expect(verifyLogin(db, "sam", "nope")).toBeNull();
    expect(verifyLogin(db, "ghost", "pw")).toBeNull();
  });
  it("tracks admin existence and rejects duplicate usernames", () => {
    expect(adminExists(db)).toBe(false);
    createUser(db, { username: "boss", password: "pw", isAdmin: true });
    expect(adminExists(db)).toBe(true);
    expect(() => createUser(db, { username: "boss", password: "x", isAdmin: false })).toThrow();
  });
  it("resets password and deletes users", () => {
    const id = createUser(db, { username: "ann", password: "old", isAdmin: false });
    resetPassword(db, id, "new");
    expect(verifyLogin(db, "ann", "old")).toBeNull();
    expect(verifyLogin(db, "ann", "new")?.id).toBe(id);
    deleteUser(db, id);
    expect(countUsers(db)).toBe(0);
  });
});
