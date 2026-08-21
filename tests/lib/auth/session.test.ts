import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";

const SECRET = "test-secret";

describe("session token", () => {
  it("verifies a valid token back to the userId", () => {
    const token = signSession(7, SECRET);
    expect(verifySession(token, SECRET)).toBe(7);
  });
  it("rejects a tampered or wrong-secret token", () => {
    const token = signSession(7, SECRET);
    expect(verifySession(token.replace("7.", "8."), SECRET)).toBeNull();
    expect(verifySession(token, "other-secret")).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
  });
});
