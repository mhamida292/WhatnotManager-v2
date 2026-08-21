import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password", () => {
  it("round-trips a correct password and rejects a wrong one", () => {
    const stored = hashPassword("hunter2");
    expect(stored).toContain(":");
    expect(verifyPassword("hunter2", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });
  it("produces a different salt each time", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
});
