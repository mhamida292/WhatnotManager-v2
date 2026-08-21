# Multi-workspace (multitenant) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let several known users each log in (username + password) and use the app against their own fully-isolated SQLite database, hosted on the user's homelab behind Tailscale.

**Architecture:** Database-per-tenant. A small users registry (`data/users.db`) holds accounts; each user's business data lives in its own `data/ws/<userId>.db` created from the existing `SCHEMA` + `migrate()`. A signed httpOnly cookie carries the userId; a per-request helper resolves it and returns the right DB handle. Almost no existing query code changes — only the connection accessor and its ~55 call sites.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, Node `crypto` (scrypt + HMAC), Vitest. No new dependencies.

## Global Constraints

- **No new dependencies** — use Node built-ins (`crypto`, `fs`, `path`) only.
- **Money stays integer cents**; no change to any business table.
- **Existing 199 tests must stay green** — they call `createDb(":memory:")` directly and pass a `db` handle into every db-module function. Do not change those function signatures.
- **DB module functions take a `db` first argument** (existing pattern). New auth modules follow the same convention so they're unit-testable with an in-memory DB.
- **better-sqlite3 cannot run in Next edge middleware** — middleware does cookie *presence/signature* checks only; authoritative user lookup happens server-side (node runtime).
- **`cookies()` and `headers()` are async in Next 15** — any helper that reads them is `async`.
- Data location is rooted at `dataDir()` = `process.env.DATA_DIR ?? <cwd>/data`. Per-user file = `dataDir()/ws/<id>.db`; registry = `dataDir()/users.db`.

---

## File Structure

**Create:**
- `src/lib/auth/users-db.ts` — registry DB opener + schema + app-secret accessor
- `src/lib/auth/password.ts` — scrypt hash/verify
- `src/lib/auth/session.ts` — sign/verify the session token (HMAC)
- `src/lib/auth/users.ts` — user CRUD + login verification (takes a `db` arg)
- `src/lib/auth/request.ts` — request-scoped helpers: `currentUser`, `requireUser`, `requireAdmin`, `dbForRequest`, cookie set/clear (uses `next/headers`)
- `src/middleware.ts` — unauthenticated → `/login`
- `src/app/login/page.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`
- `src/app/setup/page.tsx`, `src/app/api/setup/route.ts`
- `src/app/settings/users/page.tsx`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/route.ts`
- Tests under `tests/lib/auth/*` and `tests/lib/db/connection-multitenant.test.ts`

**Modify:**
- `src/lib/db/connection.ts` — `Map` cache, `getDb(userId)`, `workspacePath`, `dataDir`, adopt-legacy helper, shutdown-all
- `src/app/layout.tsx` — async; fetch current user; pass to `Nav`
- `src/components/Nav.tsx` — hide on auth pages; show workspace name + logout; admin-only Users link
- **All 33 files** that call `getDb()` → `await dbForRequest()` (Task 11)

---

## Task 1: Per-user connection layer (`getDb(userId)`)

**Files:**
- Modify: `src/lib/db/connection.ts`
- Test: `tests/lib/db/connection-multitenant.test.ts`

**Interfaces:**
- Consumes: existing `createDb(path)`, `checkpointAndClose(db)`.
- Produces:
  - `dataDir(): string`
  - `workspacePath(userId: number): string`
  - `getDb(userId: number): DB`  *(signature changes from `getDb()`)*
  - `adoptLegacyDb(userId: number): void` — if `dataDir()/whatnot.db` exists and the target workspace file doesn't, checkpoint+copy it to `workspacePath(userId)`.
  - `closeAllDbs(): void` — checkpoint+close every cached tenant DB (used by shutdown).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/db/connection-multitenant.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, workspacePath } from "@/lib/db/connection";
import { insertExpense, listExpenses } from "@/lib/db/expenses";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ws-")); process.env.DATA_DIR = dir; });
afterEach(() => { delete process.env.DATA_DIR; rmSync(dir, { recursive: true, force: true }); });

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
```

*(`insertExpense(db, { description, type, amountCents, ... })` — `type` is `"one_time" | "recurring"` and is required; see `src/lib/db/expenses.ts:8`.)*

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/connection-multitenant.test.ts`
Expected: FAIL — `getDb` currently takes no args / `workspacePath` not exported.

- [ ] **Step 3: Implement**

Replace the singleton section at the bottom of `src/lib/db/connection.ts`. Add imports at the top: `import { resolve, join } from "node:path";` (replace the existing `resolve`-only import) and `import { existsSync, mkdirSync, copyFileSync } from "node:fs";`.

```typescript
export function dataDir(): string {
  return process.env.DATA_DIR ?? resolve(process.cwd(), "data");
}

export function workspacePath(userId: number): string {
  return join(dataDir(), "ws", `${userId}.db`);
}

const cache = new Map<number, DB>();

export function getDb(userId: number): DB {
  let db = cache.get(userId);
  if (!db) {
    mkdirSync(join(dataDir(), "ws"), { recursive: true });
    db = createDb(workspacePath(userId));
    cache.set(userId, db);
    registerShutdownHandlers(); // registers once
  }
  return db;
}

/** If a pre-multitenant data/whatnot.db exists and this user has no workspace
 *  file yet, adopt it as their workspace (checkpoint first so the -wal is folded in). */
export function adoptLegacyDb(userId: number): void {
  const legacy = join(dataDir(), "whatnot.db");
  const target = workspacePath(userId);
  if (!existsSync(legacy) || existsSync(target)) return;
  const tmp = createDb(legacy);          // ensure WAL is checkpointed into the file
  checkpointAndClose(tmp);
  mkdirSync(join(dataDir(), "ws"), { recursive: true });
  copyFileSync(legacy, target);
}

export function closeAllDbs(): void {
  for (const db of cache.values()) { if (db.open) checkpointAndClose(db); }
  cache.clear();
}
```

Update `registerShutdownHandlers` to take no DB and close everything:

```typescript
let shutdownRegistered = false;
function registerShutdownHandlers(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const shutdown = () => { try { closeAllDbs(); } finally { process.exit(0); } };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
```

Delete the old `let singleton` block and the old zero-arg `getDb`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/db/connection-multitenant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/connection.ts tests/lib/db/connection-multitenant.test.ts
git commit -m "feat(db): per-user getDb(userId) with isolated workspace files"
```

---

## Task 2: Users registry DB + app secret

**Files:**
- Create: `src/lib/auth/users-db.ts`
- Test: `tests/lib/auth/users-db.test.ts`

**Interfaces:**
- Produces:
  - `openUsersDb(path: string): DB` — opens/creates a registry DB with the users schema (test-friendly; pass `:memory:`).
  - `getUsersDb(): DB` — cached registry at `dataDir()/users.db`.
  - `appSecret(db: DB): string` — returns a stable secret: `process.env.APP_SECRET` if set, else a random value persisted once in `app_meta`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/auth/users-db.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/auth/users-db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/auth/users-db.ts
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { dataDir, type DB } from "@/lib/db/connection";

const USERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function openUsersDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(USERS_SCHEMA);
  return db;
}

let cached: DB | null = null;
export function getUsersDb(): DB {
  if (!cached) {
    mkdirSync(dataDir(), { recursive: true });
    cached = openUsersDb(join(dataDir(), "users.db"));
  }
  return cached;
}

export function appSecret(db: DB): string {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const row = db.prepare("SELECT value FROM app_meta WHERE key='app_secret'").get() as { value: string } | undefined;
  if (row) return row.value;
  const secret = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('app_secret', ?)").run(secret);
  return secret;
}
```

*(Confirm `DB` is exported from `connection.ts` — it is: `export type DB = Database.Database`.)*

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/auth/users-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/users-db.ts tests/lib/auth/users-db.test.ts
git commit -m "feat(auth): users registry db + persisted app secret"
```

---

## Task 3: Password hashing

**Files:**
- Create: `src/lib/auth/password.ts`
- Test: `tests/lib/auth/password.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): string` — returns `"<saltHex>:<keyHex>"`.
  - `verifyPassword(plain: string, stored: string): boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/auth/password.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/auth/password.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/auth/password.ts
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const key = Buffer.from(keyHex, "hex");
  const test = scryptSync(plain, Buffer.from(saltHex, "hex"), 64);
  return key.length === test.length && timingSafeEqual(key, test);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/auth/password.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/password.ts tests/lib/auth/password.test.ts
git commit -m "feat(auth): scrypt password hashing"
```

---

## Task 4: Session token sign/verify

**Files:**
- Create: `src/lib/auth/session.ts`
- Test: `tests/lib/auth/session.test.ts`

**Interfaces:**
- Produces:
  - `signSession(userId: number, secret: string): string` — `"<userId>.<hmacHex>"`.
  - `verifySession(token: string | undefined, secret: string): number | null` — userId or null on tamper/missing.
  - `SESSION_COOKIE = "wn_session"` (exported constant).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/auth/session.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/auth/session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/auth/session.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "wn_session";

function sign(userId: number, secret: string): string {
  return createHmac("sha256", secret).update(String(userId)).digest("hex");
}

export function signSession(userId: number, secret: string): string {
  return `${userId}.${sign(userId, secret)}`;
}

export function verifySession(token: string | undefined, secret: string): number | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const userId = Number(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!Number.isInteger(userId)) return null;
  const expected = sign(userId, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/auth/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/session.ts tests/lib/auth/session.test.ts
git commit -m "feat(auth): HMAC session token sign/verify"
```

---

## Task 5: User CRUD + login verification

**Files:**
- Create: `src/lib/auth/users.ts`
- Test: `tests/lib/auth/users.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword` (Task 3); a registry `DB` (Task 2).
- Produces (all take `db: DB` first):
  - `type User = { id: number; username: string; is_admin: number; created_at: string }`
  - `createUser(db, { username, password, isAdmin }): number` — returns new id; throws on duplicate username.
  - `listUsers(db): User[]`
  - `getUserById(db, id): User | undefined`
  - `verifyLogin(db, username, password): User | null`
  - `resetPassword(db, id, newPassword): void`
  - `deleteUser(db, id): void`
  - `countUsers(db): number`
  - `adminExists(db): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/auth/users.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/auth/users.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/auth/users.ts
import type { DB } from "@/lib/db/connection";
import { hashPassword, verifyPassword } from "./password";

export type User = { id: number; username: string; is_admin: number; created_at: string };

const PUBLIC_COLS = "id, username, is_admin, created_at";

export function createUser(db: DB, p: { username: string; password: string; isAdmin: boolean }): number {
  const info = db
    .prepare("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)")
    .run(p.username, hashPassword(p.password), p.isAdmin ? 1 : 0, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function listUsers(db: DB): User[] {
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY id`).all() as User[];
}

export function getUserById(db: DB, id: number): User | undefined {
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function verifyLogin(db: DB, username: string, password: string): User | null {
  const row = db.prepare("SELECT id, username, is_admin, created_at, password_hash FROM users WHERE username = ?")
    .get(username) as (User & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, username: row.username, is_admin: row.is_admin, created_at: row.created_at };
}

export function resetPassword(db: DB, id: number, newPassword: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), id);
}

export function deleteUser(db: DB, id: number): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function countUsers(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function adminExists(db: DB): boolean {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1").get() as { n: number }).n > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/auth/users.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/users.ts tests/lib/auth/users.test.ts
git commit -m "feat(auth): user crud + login verification"
```

---

## Task 6: Request-scoped helpers

**Files:**
- Create: `src/lib/auth/request.ts`

**Interfaces:**
- Consumes: `getUsersDb`, `appSecret` (Task 2); `getUserById` (Task 5); `signSession`, `verifySession`, `SESSION_COOKIE` (Task 4); `getDb` (Task 1).
- Produces:
  - `currentUser(): Promise<User | null>` — reads + verifies the cookie, returns the user or null. **No redirect** (for APIs).
  - `requireUser(): Promise<User>` — `currentUser()` or `redirect("/login")` (for pages).
  - `requireAdmin(): Promise<User>` — `requireUser()` then `redirect("/")` if not admin.
  - `dbForRequest(): Promise<DB>` — `getDb((await requireUser()).id)`.
  - `setSessionCookie(userId: number): Promise<void>` / `clearSessionCookie(): Promise<void>`.

**Note:** No unit test — this module only wires `next/headers` to already-tested pure functions (Tasks 2/4/5). It's exercised by the auth API tasks below. Do not add a test that mocks `next/headers`.

- [ ] **Step 1: Implement**

```typescript
// src/lib/auth/request.ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, type DB } from "@/lib/db/connection";
import { getUsersDb, appSecret } from "./users-db";
import { getUserById, type User } from "./users";
import { signSession, verifySession, SESSION_COOKIE } from "./session";

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const reg = getUsersDb();
  const userId = verifySession(token, appSecret(reg));
  if (userId === null) return null;
  return getUserById(reg, userId) ?? null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (!u.is_admin) redirect("/");
  return u;
}

export async function dbForRequest(): Promise<DB> {
  return getDb((await requireUser()).id);
}

export async function setSessionCookie(userId: number): Promise<void> {
  const token = signSession(userId, appSecret(getUsersDb()));
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep request.ts || echo "no errors in request.ts"`
Expected: `no errors in request.ts`. *(The pre-existing `giveaway-items.test.ts` tsc error noted in project memory is unrelated; ignore it.)*

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/request.ts
git commit -m "feat(auth): request-scoped user + db helpers"
```

---

## Task 7: Setup (first-run admin) flow

**Files:**
- Create: `src/app/api/setup/route.ts`, `src/app/setup/page.tsx`

**Interfaces:**
- Consumes: `adminExists`, `createUser` (Task 5); `getUsersDb` (Task 2); `adoptLegacyDb`, `getDb` (Task 1); `setSessionCookie` (Task 6).
- Produces: `POST /api/setup` — creates the first admin, adopts the legacy DB, sets the session cookie. Returns `409` if an admin already exists.

- [ ] **Step 1: Implement the API route**

```typescript
// src/app/api/setup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getUsersDb } from "@/lib/auth/users-db";
import { adminExists, createUser } from "@/lib/auth/users";
import { adoptLegacyDb, getDb } from "@/lib/db/connection";
import { setSessionCookie } from "@/lib/auth/request";

export async function POST(req: NextRequest) {
  const reg = getUsersDb();
  if (adminExists(reg)) return NextResponse.json({ error: "Already set up" }, { status: 409 });
  const { username, password } = await req.json();
  if (!username || !password) return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  const id = createUser(reg, { username, password, isAdmin: true });
  adoptLegacyDb(id); // bring data/whatnot.db forward as the admin's workspace, if present
  getDb(id);         // ensure the workspace file exists (fresh if no legacy)
  await setSessionCookie(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implement the setup page**

```tsx
// src/app/setup/page.tsx
import { redirect } from "next/navigation";
import { getUsersDb } from "@/lib/auth/users-db";
import { adminExists } from "@/lib/auth/users";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (adminExists(getUsersDb())) redirect("/login");
  return (
    <AuthForm
      title="Create your admin account"
      subtitle="First-time setup — this account manages users."
      action="/api/setup"
      submitLabel="Create admin"
    />
  );
}
```

*(`AuthForm` is built in Task 8.)*

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -E "setup" || echo ok`
Expected: `ok` (AuthForm import will resolve after Task 8; if running standalone, do Task 8 first or expect only the missing-AuthForm error).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/setup/route.ts src/app/setup/page.tsx
git commit -m "feat(auth): first-run admin setup flow"
```

---

## Task 8: Login + shared AuthForm

**Files:**
- Create: `src/components/AuthForm.tsx`, `src/app/login/page.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`

**Interfaces:**
- Consumes: `verifyLogin` (Task 5), `getUsersDb` (Task 2), `setSessionCookie`/`clearSessionCookie` (Task 6), `countUsers` (Task 5).
- Produces: `AuthForm` (client component, posts JSON to `action`, redirects to `/` on success); `POST /api/auth/login`; `POST /api/auth/logout`.

- [ ] **Step 1: Implement AuthForm (shared by login + setup)**

```tsx
// src/components/AuthForm.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ title, subtitle, action, submitLabel }: {
  title: string; subtitle?: string; action: string; submitLabel: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch(action, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) { router.push("/"); router.refresh(); return; }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Something went wrong");
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input className="w-full rounded border border-line px-3 py-2" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <input className="w-full rounded border border-line px-3 py-2" placeholder="Password" type="password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full rounded bg-brand-600 px-3 py-2 text-white disabled:opacity-50">
          {busy ? "…" : submitLabel}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Implement login page + routes**

```tsx
// src/app/login/page.tsx
import { redirect } from "next/navigation";
import { getUsersDb } from "@/lib/auth/users-db";
import { countUsers } from "@/lib/auth/users";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (countUsers(getUsersDb()) === 0) redirect("/setup");
  return <AuthForm title="Sign in" action="/api/auth/login" submitLabel="Sign in" />;
}
```

```typescript
// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getUsersDb } from "@/lib/auth/users-db";
import { verifyLogin } from "@/lib/auth/users";
import { setSessionCookie } from "@/lib/auth/request";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  const user = verifyLogin(getUsersDb(), username ?? "", password ?? "");
  if (!user) return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}
```

```typescript
// src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/request";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -E "login|AuthForm|setup" || echo ok`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/components/AuthForm.tsx src/app/login src/app/api/auth
git commit -m "feat(auth): login/logout + shared auth form"
```

---

## Task 9: Middleware gate

**Files:**
- Create: `src/middleware.ts`

**Interfaces:**
- Consumes: `SESSION_COOKIE` (Task 4).
- Produces: redirect to `/login` for any request lacking the session cookie, except the allow-list. **Presence check only** (no DB, no HMAC verify — edge runtime). Authoritative verification stays in `currentUser()`.

- [ ] **Step 1: Implement**

```typescript
// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

const PUBLIC = ["/login", "/setup", "/api/auth/login", "/api/setup"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (req.cookies.get(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

// Run on everything except Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Manual smoke (after Task 11 makes pages compile)**

Run: `npm run dev`, open the app in a private window. Expected: redirected to `/login` (or `/setup` on a fresh DB). After login, pages load.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(auth): middleware redirects unauthenticated to /login"
```

---

## Task 10: Nav + root layout (workspace name, logout, admin link)

**Files:**
- Modify: `src/app/layout.tsx`, `src/components/Nav.tsx`

**Interfaces:**
- Consumes: `currentUser` (Task 6).
- Produces: `Nav` receives `user: { username: string; is_admin: number } | null`; renders nothing on `/login` and `/setup` or when `user` is null; shows the username, a Logout button, and a Users link when `is_admin`.

- [ ] **Step 1: Make the layout async and pass the user**

```tsx
// src/app/layout.tsx
import "./globals.css";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import { currentUser } from "@/lib/auth/request";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
export const metadata = { title: "Whatnot Business Manager" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        <Nav user={user ? { username: user.username, is_admin: user.is_admin } : null} />
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Update Nav**

Add the admin link to the links array conditionally, render the username + logout, and hide on auth pages. Replace `src/components/Nav.tsx` with:

```tsx
"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const baseLinks: [string, string][] = [
  ["/", "Dashboard"], ["/shows", "Shows"], ["/inventory", "Inventory"],
  ["/invoices", "Invoices"], ["/expenses", "Expenses"], ["/report", "Report"], ["/settings", "Settings"],
];

export function Nav({ user }: { user: { username: string; is_admin: number } | null }) {
  const path = usePathname();
  const router = useRouter();
  if (!user || path === "/login" || path === "/setup") return null;
  const links = user.is_admin ? [...baseLinks, ["/settings/users", "Users"] as [string, string]] : baseLinks;
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login"); router.refresh();
  }

  return (
    <nav className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6">
        <span className="shrink-0 py-4 text-sm font-bold tracking-tight text-brand-600">◆ Whatnot</span>
        <div className="flex gap-5 overflow-x-auto">
          {links.map(([href, label]) => {
            const on = isActive(href);
            return (
              <Link key={href} href={href}
                className={`shrink-0 whitespace-nowrap border-b-2 py-4 text-sm transition-colors ${
                  on ? "border-brand-600 font-semibold text-slate-900"
                     : "border-transparent text-slate-500 hover:text-slate-900"}`}>
                {label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 text-sm text-slate-500">
          <span>{user.username}</span>
          <button onClick={logout} className="text-slate-500 hover:text-slate-900">Logout</button>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -E "Nav|layout" || echo ok`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/components/Nav.tsx
git commit -m "feat(auth): nav shows workspace + logout, admin users link"
```

---

## Task 11: Migrate all `getDb()` call sites to `await dbForRequest()`

**Files (modify — every file that calls `getDb()`):**

API routes (already `async`): `src/app/api/aliases/route.ts`, `aliases/seen/route.ts`, `dashboard/route.ts`, `expenses/route.ts`, `giveaway-items/route.ts`, `inventory/route.ts`, `invoices/route.ts`, `invoices/[id]/route.ts`, `invoices/[id]/lines/route.ts`, `invoices/[id]/post/route.ts`, `ledger/route.ts`, `ledger/preview/route.ts`, `purchases/route.ts`, `report/route.ts`, `reset/route.ts`, `settings/route.ts`, `shows/route.ts`, `shows/preview/route.ts`, `shows/[id]/giveaways/route.ts`, `shows/[id]/bundles/route.ts`, `backup/export/route.ts`, `backup/import/route.ts`.

Page/server components: `src/app/page.tsx`, `src/app/report/page.tsx`, `src/app/settings/page.tsx`, `src/app/shows/page.tsx`, `src/app/shows/[id]/page.tsx`, `src/app/inventory/page.tsx`, `src/app/inventory/[id]/page.tsx`, `src/app/invoices/page.tsx`, `src/app/invoices/[id]/page.tsx`, `src/app/invoices/[id]/print/page.tsx`, `src/app/expenses/page.tsx`.

**Uniform transformation** (apply to each file):
1. Replace the import `import { getDb } from "@/lib/db/connection";` with `import { dbForRequest } from "@/lib/auth/request";`.
2. Replace every `getDb()` with `await dbForRequest()`.
3. Ensure the **enclosing function is `async`**. The six page components currently declared `export default function XPage()` must become `export default async function XPage()`. (Confirmed sync today: `invoices/page.tsx`, `expenses/page.tsx`, `inventory/page.tsx`, `settings/page.tsx`, `shows/page.tsx`, `report/page.tsx`.) API handlers are already `async`.
4. If a server component computed values inline at call time (e.g. `<SettingsForm initial={getSettings(getDb())} />`), hoist to a `const db = await dbForRequest();` at the top of the now-`async` component and reference `db`.

**Example — route handler** (`src/app/api/expenses/route.ts`):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { insertExpense, listExpenses } from "@/lib/db/expenses";

export async function GET() {
  return NextResponse.json(listExpenses(await dbForRequest()));
}
export async function POST(req: NextRequest) {
  const id = insertExpense(await dbForRequest(), await req.json());
  return NextResponse.json({ id });
}
```

**Example — sync page → async** (`src/app/settings/page.tsx`):

```tsx
import { dbForRequest } from "@/lib/auth/request";
import { getSettings } from "@/lib/db/settings";
import { SettingsForm } from "@/components/SettingsForm";
import GiveawayItemsManager from "@/components/GiveawayItemsManager";
import { BackupRestore } from "@/components/BackupRestore";
import { DangerZone } from "@/components/DangerZone";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = await dbForRequest();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Profit split, giveaway cost, and defaults" />
      <SettingsForm initial={getSettings(db)} />
      <GiveawayItemsManager />
      <BackupRestore />
      <DangerZone />
    </div>
  );
}
```

- [ ] **Step 1: Apply the transformation to every file listed above.**

- [ ] **Step 2: Verify no stray zero-arg `getDb()` remains**

Run: `grep -rn "getDb()" src/app && echo "FOUND ZERO-ARG CALLS" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Verify only `connection.ts` imports `getDb` directly**

Run: `grep -rln "from \"@/lib/db/connection\"" src/app | xargs grep -l "getDb" || echo "no app file imports getDb"`
Expected: `no app file imports getDb` (app files now import `dbForRequest`; `getDb` is used only inside `connection.ts`, `request.ts`, and `setup/route.ts`).

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit 2>&1 | grep -v "giveaway-items.test" | grep "error TS" || echo "no new tsc errors"`
Expected: `no new tsc errors` (the pre-existing `giveaway-items.test.ts` error is filtered out — see project memory).
Run: `npx vitest run`
Expected: all green (still 199+ tests; unit tests are unaffected by call-site changes).

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "refactor(db): resolve per-request workspace via dbForRequest() at all call sites"
```

---

## Task 12: Admin Users page

**Files:**
- Create: `src/app/settings/users/page.tsx`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/route.ts`, `src/components/UsersManager.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, `currentUser` (Task 6); `listUsers`, `createUser`, `resetPassword`, `deleteUser` (Task 5); `getUsersDb` (Task 2); `closeAllDbs`/workspace file path (Task 1).
- Produces: admin-only page listing users with add / reset-password / delete; APIs guarded by `requireAdmin`. Admin cannot delete themselves. Deleting a user also removes their `data/ws/<id>.db` file.

- [ ] **Step 1: List + create API**

```typescript
// src/app/api/admin/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/request";
import { getUsersDb } from "@/lib/auth/users-db";
import { listUsers, createUser } from "@/lib/auth/users";

export async function GET() {
  await requireAdmin();
  return NextResponse.json(listUsers(getUsersDb()));
}

export async function POST(req: NextRequest) {
  await requireAdmin();
  const { username, password } = await req.json();
  if (!username || !password) return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  try {
    const id = createUser(getUsersDb(), { username, password, isAdmin: false });
    return NextResponse.json({ id });
  } catch {
    return NextResponse.json({ error: "That username is taken" }, { status: 409 });
  }
}
```

- [ ] **Step 2: Reset-password + delete API**

```typescript
// src/app/api/admin/users/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { existsSync, rmSync } from "node:fs";
import { requireAdmin } from "@/lib/auth/request";
import { getUsersDb } from "@/lib/auth/users-db";
import { resetPassword, deleteUser } from "@/lib/auth/users";
import { workspacePath, closeAllDbs } from "@/lib/db/connection";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  const { password } = await req.json();
  if (!password) return NextResponse.json({ error: "Password required" }, { status: 400 });
  resetPassword(getUsersDb(), id, password);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const id = Number((await params).id);
  if (id === admin.id) return NextResponse.json({ error: "You can't delete yourself" }, { status: 400 });
  deleteUser(getUsersDb(), id);
  closeAllDbs(); // drop any open handle to the file we're about to remove
  const file = workspacePath(id);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(file + suffix)) rmSync(file + suffix);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: UsersManager client component**

```tsx
// src/components/UsersManager.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = { id: number; username: string; is_admin: number; created_at: string };

export function UsersManager({ users, currentUserId }: { users: Row[]; currentUserId: number }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) { setUsername(""); setPassword(""); router.refresh(); }
    else setError((await res.json().catch(() => ({})))?.error ?? "Failed");
  }

  async function reset(id: number) {
    const pw = prompt("New password for this user:");
    if (!pw) return;
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    router.refresh();
  }

  async function remove(id: number, name: string) {
    if (prompt(`Type DELETE to permanently remove "${name}" and all their data.`) !== "DELETE") return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <input className="rounded border border-line px-3 py-2" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="rounded border border-line px-3 py-2" placeholder="Temp password" type="text"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="rounded bg-brand-600 px-3 py-2 text-white">Add user</button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </form>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th className="py-2">User</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-line">
              <td className="py-2">{u.username}</td>
              <td>{u.is_admin ? "Admin" : "User"}</td>
              <td className="space-x-3 text-right">
                <button onClick={() => reset(u.id)} className="text-slate-500 hover:text-slate-900">Reset password</button>
                {u.id !== currentUserId &&
                  <button onClick={() => remove(u.id, u.username)} className="text-red-600 hover:text-red-800">Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 4: Users page (admin-guarded)**

```tsx
// src/app/settings/users/page.tsx
import { requireAdmin } from "@/lib/auth/request";
import { getUsersDb } from "@/lib/auth/users-db";
import { listUsers } from "@/lib/auth/users";
import { UsersManager } from "@/components/UsersManager";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const admin = await requireAdmin();
  const users = listUsers(getUsersDb());
  return (
    <div className="space-y-6">
      <PageHeader title="Users" subtitle="Add or remove people who can log in" />
      <UsersManager users={users} currentUserId={admin.id} />
    </div>
  );
}
```

- [ ] **Step 5: Verify build + tests**

Run: `npx tsc --noEmit 2>&1 | grep -v "giveaway-items.test" | grep "error TS" || echo "no new tsc errors"`
Expected: `no new tsc errors`.
Run: `npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/users src/app/api/admin src/components/UsersManager.tsx
git commit -m "feat(auth): admin users page (add/reset/delete + workspace cleanup)"
```

---

## Task 13: Manual end-to-end verification + README/docs

**Files:**
- Modify: `README.md` (document `APP_SECRET`, `DATA_DIR`, the per-user `data/ws/` files, and first-run setup), `docker-compose.yml` (add `APP_SECRET` env + ensure `data/` volume persists).

- [ ] **Step 1: Fresh-DB smoke test**

```bash
rm -rf .next
DATA_DIR=$(mktemp -d) npm run dev
```
- Visit app → redirected to `/setup`. Create admin → land on dashboard.
- Settings → Users → add "tester". Logout. Log in as "tester" → empty workspace (no shows/inventory). Confirm admin's data is NOT visible.
- Log back in as admin → original data intact. Confirm Excel export → factory reset → import round-trips within the admin workspace.

- [ ] **Step 2: Legacy-adoption smoke test**

With your real `data/whatnot.db` present and **no** `data/ws/` yet: run setup, create the admin, and confirm all existing shows/inventory/ledger appear (the legacy DB was adopted as `data/ws/1.db`). Confirm `data/whatnot.db` is untouched (it was copied, not moved).

- [ ] **Step 3: Document env + ops in README**

Add a section: set `APP_SECRET` (a long random string) and `DATA_DIR` in production; per-user data lives in `data/ws/<id>.db`; the registry is `data/users.db`; first visit creates the admin; back up `data/` (or per-workspace Excel exports). Note that all of `data/` is gitignored.

- [ ] **Step 4: Commit**

```bash
git add README.md docker-compose.yml
git commit -m "docs: document multi-workspace setup (APP_SECRET, DATA_DIR, data/ws)"
```

---

## Self-Review Notes (coverage against spec)

- **DB-per-tenant** → Task 1 (`getDb(userId)`, `workspacePath`, isolation test).
- **User registry separate from tenant data** → Task 2 (`data/users.db`).
- **Username+password, scrypt, signed cookie** → Tasks 3, 4, 6, 8.
- **Admin-provisioned accounts, no public signup** → Task 12 (admin-guarded APIs; no signup route exists).
- **First-run setup + adopt `data/whatnot.db`** → Tasks 1 (`adoptLegacyDb`) + 7.
- **Middleware gate** → Task 9.
- **Per-workspace settings/backup/reset for free** → inherited; verified in Task 13 Step 1.
- **Delete user removes their DB file; admin can't self-delete** → Task 12.
- **Existing 199 tests stay green** → asserted in Tasks 11 & 12 verification steps.
- **No new dependencies** → all Node built-ins.
