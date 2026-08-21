# Per-Account Workspaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every account its own database — `data/ws/<userId>.db` — restoring the isolation model the app had before the July warehouse conversion.

**Architecture:** One line does the work: `dbForRequest()` returns `getDb(user.id)` instead of `getDb(SHARED_WORKSPACE_ID)`. Every page, route, report, backup and import already resolves its database through that function, so they all become per-account with no further edits. `getDb` already creates the file on first access, so new accounts need no provisioning. The rest of the plan is removing the now-dead shared-workspace scaffolding and proving isolation with real tests.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest (node env, no React Testing Library).

## Global Constraints

- Work on branch `feat/per-account-workspaces`. Never commit to `main`.
- **Never delete or modify any file under `data/`.** The owner's real databases live there. Tests use `:memory:` or a scratch `DATA_DIR`.
- Deleting a user must **not** delete their workspace file. That is deliberate — an orphaned file is recoverable, a deleted business is not.
- The existing suite (410 tests) must stay green apart from the one shared-workspace test this plan intentionally replaces.
- Run `npm test` before every commit. Run `npm run build` before the final commit.

---

## File Structure

**Modified:**
- `src/lib/auth/request.ts` — `dbForRequest()` resolves the caller's own workspace
- `src/app/api/setup/route.ts` — stop pre-creating and adopting a shared workspace
- `src/lib/db/connection.ts` — remove `SHARED_WORKSPACE_ID` and `adoptLegacyDb`

**Deleted:**
- `tests/lib/db/shared-workspace.test.ts` — asserts the behavior being removed

**Created:**
- `tests/lib/db/per-account-isolation.test.ts` — the real isolation guarantee

---

### Task 1: Route each request to its own workspace

**Files:**
- Modify: `src/lib/auth/request.ts:28-31`
- Create: `tests/lib/db/per-account-isolation.test.ts`
- Delete: `tests/lib/db/shared-workspace.test.ts`

**Interfaces:**
- Produces: `dbForRequest()` returns the logged-in user's own DB. Later tasks only remove scaffolding; nothing else consumes a new symbol.

- [ ] **Step 1: Write the failing isolation test**

Create `tests/lib/db/per-account-isolation.test.ts`. It must exercise **real** databases on a scratch `DATA_DIR`, not `:memory:`, because the guarantee is about file routing. Set `process.env.DATA_DIR` to a unique temp directory before importing/using `getDb`, and clean it up afterwards.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ws-iso-"));
  process.env.DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
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
```

If the dynamic `await import` pattern fights the module cache (because `dataDir()` reads `process.env.DATA_DIR` at call time, not import time), a plain top-level import is fine — check `connection.ts:252` and use whichever is correct. Do **not** point these tests at the repo's real `data/` directory under any circumstance.

- [ ] **Step 2: Run it to verify the isolation case fails**

Run: `npx vitest run tests/lib/db/per-account-isolation.test.ts`
Expected: the path and handle cases may already pass (`getDb` is per-id today); the point of this step is to confirm the suite runs against a scratch dir and that you have a red-to-green signal for the routing change in Step 4. Record what you observed.

- [ ] **Step 3: Delete the obsolete test**

`tests/lib/db/shared-workspace.test.ts` asserts `SHARED_WORKSPACE_ID === 0` and that it maps to `ws/0.db`. It documents the behavior being removed, so it goes. This is a deliberate replacement, not a test deleted to make something pass — `per-account-isolation.test.ts` is its successor and covers strictly more.

```bash
git rm tests/lib/db/shared-workspace.test.ts
```

- [ ] **Step 4: Make the switch**

In `src/lib/auth/request.ts`:

```ts
export async function dbForRequest(): Promise<DB> {
  const u = await requireUser();
  return getDb(u.id);
}
```

Remove `SHARED_WORKSPACE_ID` from that file's import of `@/lib/db/connection`. Update the doc comment if it mentions a shared workspace.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. If another test depended on the shared workspace, report it rather than weakening it — the plan expects only `shared-workspace.test.ts` to be affected.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/request.ts tests/
git commit -m "feat(access): each account reads and writes its own workspace DB"
```

---

### Task 2: Remove the shared-workspace scaffolding

**Files:**
- Modify: `src/app/api/setup/route.ts`, `src/lib/db/connection.ts`

**Interfaces:**
- Consumes: `dbForRequest()` already per-account (Task 1).
- Produces: `SHARED_WORKSPACE_ID` and `adoptLegacyDb` no longer exist.

- [ ] **Step 1: Simplify the setup route**

`src/app/api/setup/route.ts` currently calls `adoptLegacyDb(SHARED_WORKSPACE_ID)` and `getDb(SHARED_WORKSPACE_ID)` after creating the first admin. Both go — the admin's workspace is created on their first authenticated request like anyone else's. Remove those two lines and the now-unused imports, leaving the user creation and `setSessionCookie(id)` untouched.

Note the route has a duplicated `if (adminExists(reg))` guard (once before and once after reading the body). Leave it alone — it is out of scope and harmless.

- [ ] **Step 2: Remove the constants**

In `src/lib/db/connection.ts`:
- Delete the `SHARED_WORKSPACE_ID` export and its doc comment (around lines 9-11).
- Delete `adoptLegacyDb` (around lines 277-287) — Step 1 removed its only caller.
- Remove any import that becomes unused as a result (likely `copyFileSync`, possibly `existsSync` — check whether the rest of the file still uses them before deleting).

Leave `workspacePath` and `getDb` exactly as they are.

- [ ] **Step 3: Confirm nothing else references them**

Run: `grep -rn 'SHARED_WORKSPACE_ID\|adoptLegacyDb' src/ tests/ scripts/`
Expected: no output. If a script references them, fix the script; report what you found.

- [ ] **Step 4: Run tests and build**

Run: `npm test` then `npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "refactor(db): drop SHARED_WORKSPACE_ID and legacy adoption"
```

---

### Task 3: Verify isolation end to end

**Files:** none modified — verification only.

- [ ] **Step 1:** Run `npm test` — Expected: PASS, including the new isolation tests.
- [ ] **Step 2:** Run `npm run build` — Expected: succeeds.
- [ ] **Step 3:** Confirm the real data directory was never touched: `git status` clean, and `ls data/ws/` still shows the same files with the same sizes as before the task started (record them at the start).
- [ ] **Step 4: Smoke on a dev copy.** Copy `data/` to a scratch directory and run `DATA_DIR=<copy> npx next dev -p 3010`. Log in as one account, add an inventory item, log out, log in as a second account, and confirm the item is **not** visible and the inventory is empty. Confirm a brand-new account created from Settings → Users lands on a working, empty app rather than an error. Confirm no dev-server console errors.
- [ ] **Step 5:** Verify `data/ws/` inside the scratch copy now contains a distinct file per account that logged in.
- [ ] **Step 6: Final commit** only if fixups were needed.

---

## Self-Review

**Spec coverage:** §1 the switch → Task 1. §2 account lifecycle → covered by existing code (no change needed: `getDb` auto-creates, `deleteUser` already leaves the file, ids are `AUTOINCREMENT`) and asserted by Task 1's new-account test. §3 removals → Task 2. §4 re-uploading → no code needed; the importer already writes to `dbForRequest()`. Testing section → Tasks 1 and 3.

**Deliberate non-change:** `deleteUser` is not touched. The spec requires the workspace file to survive a user deletion, and today's implementation already deletes only the registry row — so the correct action is to change nothing and let the smoke test confirm it.

**Known risks:** (1) The isolation tests must not run against the repo's real `data/` — Task 1 Step 1 sets a scratch `DATA_DIR` and says so explicitly. (2) `dataDir()` reads `process.env.DATA_DIR` at call time (`connection.ts:252`); if that proves wrong, the test's import strategy needs adjusting, which Step 1 calls out. (3) The module-level `cache` in `getDb` persists across tests in a file — the tests are written to tolerate that (same-handle assertion depends on it).

## Port note (after completion)

This reverts an access-model decision specific to this app's deployment. Do **not** add it to `docs/PORT-TO-WHATNOT-MANAGER.md` — the sibling app never adopted the shared-workspace model, so there is nothing to port.
