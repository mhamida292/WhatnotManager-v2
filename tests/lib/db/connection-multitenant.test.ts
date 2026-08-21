import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, workspacePath, closeAllDbs } from "@/lib/db/connection";
import { insertExpense, listExpenses } from "@/lib/db/expenses";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ws-")); process.env.DATA_DIR = dir; });
afterEach(() => { closeAllDbs(); delete process.env.DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

describe("getDb(userId)", () => {
  it("isolates data between users and caches the handle", () => {
    expect(workspacePath(1)).toBe(join(dir, "ws", "1.db"));
    const a = getDb(1);
    const b = getDb(2);
    expect(getDb(1)).toBe(a);            // cached, same handle
    insertExpense(a, { description: "A only", type: "one_time", amountCents: 100, incurredOn: "2026-06-24" });
    expect(listExpenses(a)).toHaveLength(1);
    expect(listExpenses(b)).toHaveLength(0); // user 2 unaffected
  });
});
