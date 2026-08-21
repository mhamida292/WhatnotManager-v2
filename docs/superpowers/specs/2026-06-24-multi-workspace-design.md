# Multi-workspace (multitenant) — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorm complete, ready for implementation plan)

## Goal

Let a handful of known people (≈5–20) each use the Whatnot Business Manager
with their own fully-isolated data, hosted on the user's homelab behind
Tailscale. Each person logs in and sees only their own shows, inventory,
ledger, invoices, and settings.

## Constraints / context

- App today is **single-user, no-auth**: one SQLite file `data/whatnot.db`,
  opened via a global `singleton` in `src/lib/db/connection.ts` (`getDb()`).
- Runs **behind Tailscale** on the user's homelab — the tailnet is the real
  security boundary. The user is **not worried about strong security**; the
  goal of auth is to keep workspaces *separated*, not to repel attackers.
- Users explicitly want a **username + password gate** (so people can't get
  into each other's workspaces) — **no workspace picker**, **no public signup**.
- Accounts are **provisioned by an admin** (the user) from inside the app.

## Decisions (settled during brainstorm)

1. **Isolation model: database-per-tenant.** One SQLite file per user. This
   keeps essentially all existing query code unchanged, gives bulletproof
   isolation (no `WHERE tenant_id` to forget), and makes per-user
   backup/restore/factory-reset work for free. Rejected: shared DB +
   `tenant_id` column (large error-prone edit, leak risk, only needed for
   cross-tenant aggregates we don't want).

2. **Access model: username + password login.** No picker, no public signup.
   Passwords hashed with Node's built-in `crypto.scrypt` (no new deps). Session
   is a signed httpOnly cookie. Kept deliberately light because of Tailscale.
   Rejected: passwordless workspace picker (user wants a gate); full
   OAuth/heavy account system (overkill behind Tailscale).

3. **Provisioning: admin page in the app.** One account is admin (the user).
   Admin gets a Users page to add/remove users and reset passwords. Rejected:
   CLI-only (needs shell access each time); self-signup-then-approve (extra
   states, overkill for known people).

## Architecture

### User registry (separate from tenant data)

A small **users registry** lives in its own store, separate from the per-tenant
business DBs, so listing/managing users never opens everyone's files.

- Store: `data/users.db` (its own better-sqlite3 file).
- Table `users`:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `username TEXT NOT NULL UNIQUE`
  - `password_hash TEXT NOT NULL` (scrypt: `salt:derivedKey`, hex)
  - `is_admin INTEGER NOT NULL DEFAULT 0`
  - `created_at TEXT NOT NULL`
- Workspace DB filename is **derived** from id (`data/ws/<id>.db`), not stored,
  to avoid drift.

### Per-tenant business data

- Each user's data lives in `data/ws/<userId>.db`.
- Created on demand from the existing `SCHEMA` + `migrate()` the first time that
  user's DB is opened (same code path as today, different path argument).
- **No changes to any table definitions or queries** in `src/lib/db/*` beyond
  the connection layer — every existing module keeps operating on a `DB` handle.

### Connection layer refactor (`src/lib/db/connection.ts`)

- Replace the single `singleton: DB | null` with a `Map<number, DB>` keyed by
  `userId`.
- `getDb()` → **`getDb(userId: number): DB`**: returns the cached handle or
  creates `data/ws/<userId>.db` via the existing `createDb(path)` (unchanged
  pragmas, `SCHEMA`, `migrate()`).
- The users registry gets its own opener (`getUsersDb()`) using the same
  `better-sqlite3` setup but a dedicated tiny schema.
- **Shutdown handler** updated to `checkpointAndClose` *every* open tenant DB
  plus the users DB (today it closes the one singleton).

### Request context helper

- A helper (e.g. `src/lib/auth/session.ts` → `getCurrentUser()` /
  `requireUser()`) reads the signed session cookie, verifies it, resolves the
  `userId`, and returns the user row.
- A `dbForRequest()` helper wraps `getDb(currentUser.id)`.
- **Every API route and server component** that currently calls `getDb()` calls
  `dbForRequest()` (or `getDb(userId)`) instead. This is the bulk of the
  mechanical edits — find-and-replace-shaped, not new logic.

### Auth

- **Password hashing:** `crypto.scryptSync` with a random 16-byte salt; store
  `salt:hash` hex. Verify with `timingSafeEqual`.
- **Session cookie:** httpOnly, `SameSite=Lax`. Value = `userId.HMAC` where the
  HMAC is `crypto.createHmac('sha256', APP_SECRET)` over the userId. Verified on
  every request; tampering ⇒ treated as logged out.
- **`APP_SECRET`** env var (documented in README / docker-compose). If unset,
  fall back to a value persisted in `data/users.db` on first run so a missing
  env doesn't silently invalidate all sessions.
- **Login page** `/login`: username + password form → POST `/api/auth/login` →
  set cookie, redirect to dashboard.
- **Logout** `/api/auth/logout`: clears the cookie.
- **Middleware** `src/middleware.ts`: requests without a valid session cookie
  redirect to `/login` (allow-list: `/login`, `/setup`, auth APIs, static
  assets). Admin-only routes additionally require `is_admin`.

### First-run bootstrap

- If the `users` table is empty, all traffic routes to a one-time **`/setup`**
  page that creates the **admin** account (username + password, `is_admin=1`).
- On admin creation, the existing **`data/whatnot.db` is migrated to become the
  admin's workspace** by copying/renaming it to `data/ws/<adminId>.db` (so no
  existing data is lost). If `data/whatnot.db` is absent, a fresh empty
  workspace is created instead.
- After an admin exists, `/setup` is inaccessible (redirects to `/login`).

### Admin "Users" page (`/settings/users`, admin-only)

- **List** users (username, is_admin, created_at).
- **Add user**: username + temporary password → inserts a `users` row; their
  empty workspace DB is created lazily on first login (or eagerly on add).
- **Reset password**: set a new password hash for a user.
- **Delete user**: removes the `users` row **and** deletes their
  `data/ws/<id>.db` file, behind a typed-confirm gate (mirroring the existing
  factory-reset "type RESET" pattern). Admin cannot delete themselves.
- Non-admins never see the page (middleware + nav hide it).

## What becomes per-workspace for free

Because each workspace is a complete, separate DB, these already-built features
become per-user with no extra work:

- **Settings** (owner-share %, business name, giveaway unit cost, default
  shipping supplies) — already a single-row `app_settings` table, now one per
  workspace.
- **Excel backup / restore** — operates on one DB file; now per-user.
- **Factory reset** (`resetApp`) — wipes one workspace, not everyone.
- **All** inventory / shows / ledger / invoices / bundles / giveaways.

## Error handling

- Login with bad credentials ⇒ generic "invalid username or password".
- Request with missing/invalid/tampered cookie ⇒ redirect to `/login`.
- Non-admin hitting an admin route/API ⇒ 403 (and hidden from nav).
- Deleting a user whose DB file is currently open ⇒ close + checkpoint that
  handle first, then delete the file; drop it from the cache.
- Duplicate username on add ⇒ surfaced as a form error (UNIQUE constraint).

## Testing

New unit tests:

- Password hash round-trip (`hash` then `verify`, wrong password fails).
- Cookie sign/verify (valid passes, tampered/forged fails).
- `getDb(userId)` caching + isolation: two userIds ⇒ two files; writes to one
  do not appear in the other.
- First-run bootstrap: empty registry ⇒ `/setup`; after admin exists ⇒ login.
- Admin guard: non-admin denied on Users API.
- Existing **177 tests keep passing unchanged** (they construct their own `DB`
  via `createDb(":memory:")`-style helpers, independent of the singleton).

## Out of scope (YAGNI)

- Cross-tenant / aggregate reporting across workspaces.
- Public self-signup, email verification, password-reset-by-email.
- Roles beyond `is_admin` / regular user.
- Exposing the app to the public internet (Tailscale is the boundary).
- Per-workspace PINs *on top of* login (the login password already gates).
