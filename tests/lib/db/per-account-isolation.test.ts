import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let prevDataDir: string | undefined;
beforeAll(() => {
  prevDataDir = process.env.DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), "ws-iso-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  const { closeAllDbs } = await import("@/lib/db/connection");
  closeAllDbs();
  rmSync(dir, { recursive: true, force: true });
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
});

describe("per-account workspaces", () => {
  it("maps each user id to its own workspace file", async () => {
    const { workspacePath } = await import("@/lib/db/connection");
    expect(workspacePath(1).endsWith("/ws/1.db")).toBe(true);
    expect(workspacePath(2).endsWith("/ws/2.db")).toBe(true);
    expect(workspacePath(1)).not.toBe(workspacePath(2));
  });

  it("returns one handle per id, and distinct handles across ids", async () => {
    const { getDb } = await import("@/lib/db/connection");
    expect(getDb(1)).toBe(getDb(1));
    expect(getDb(1)).not.toBe(getDb(2));
  });

  it("keeps one account's inventory invisible to another", async () => {
    const { getDb } = await import("@/lib/db/connection");
    const { insertItem, listItems } = await import("@/lib/db/inventory");

    insertItem(getDb(1), { name: "User One Widget", unitCostCents: 100, qtyPurchased: 5, lotId: null });

    expect(listItems(getDb(1)).map((i) => i.name)).toContain("User One Widget");
    expect(listItems(getDb(2))).toEqual([]);

    insertItem(getDb(2), { name: "User Two Gadget", unitCostCents: 200, qtyPurchased: 2, lotId: null });
    expect(listItems(getDb(1)).map((i) => i.name)).not.toContain("User Two Gadget");
  });

  it("gives a brand-new account an empty but working workspace", async () => {
    const { getDb } = await import("@/lib/db/connection");
    const { listItems } = await import("@/lib/db/inventory");
    const db = getDb(99);
    expect(listItems(db)).toEqual([]);
    expect((db.prepare("SELECT COUNT(*) AS c FROM invoices").get() as any).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS c FROM ledger_transactions").get() as any).c).toBe(0);
  });
});
