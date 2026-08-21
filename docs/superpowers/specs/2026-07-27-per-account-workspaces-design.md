# Per-Account Workspaces — Design

**Date:** 2026-07-27
**Status:** Approved (pending spec review)

## Context

The app opened one database per user until 2026-07-17, when the warehouse
conversion (`2026-07-17-warehouse-app-conversion-design.md` §1) deliberately
routed every login to a single shared workspace so warehouse **staff** could
work on one set of books. `dbForRequest()` has returned `getDb(SHARED_WORKSPACE_ID)`
— always `data/ws/0.db` — ever since, and the user id is never consulted.

The owner now wants the opposite: multiple accounts, each with **its own
separate database**. This restores the model from
`2026-06-24-multi-workspace-design.md`, whose reasoning still holds —
database-per-tenant keeps every existing query unchanged, makes isolation
structural rather than a `WHERE` clause anyone can forget, and gives per-account
backup/restore for free.

The registry already supports it: `data/users.db` holds ids 1 (`mhamida`, admin),
2 (`demo`), 3 (`farid2`), and orphaned `ws/1.db`, `ws/2.db`, `ws/3.db` from the
old era still sit on disk. Two scripts (`scripts/seed-demo.ts:43`,
`scripts/automap.ts:40`) still call `getDb(user.id)` and today read databases the
app never serves — this change makes them correct again.

**Owner's decision on existing data:** delete it all and re-upload each account's
data through the Excel importer. So this design needs **no adoption, migration,
or ownership-assignment logic**.

## Goals

1. Every account reads and writes its own `data/ws/<userId>.db`.
2. A new account gets a working, empty workspace with no manual setup.
3. Data written by one account is invisible to every other — verified by test,
   not asserted.
4. No account can ever be handed a deleted account's data.

## Out of Scope

- Shared/team workspaces. One database per account, full stop.
- A workspace picker or any cross-account view.
- Migrating or reassigning existing data — the owner is re-uploading.
- Changing login, sessions, or the Settings → Users page.

## Design

### 1. The switch

`dbForRequest()` (`src/lib/auth/request.ts:28-31`) returns `getDb(user.id)`
instead of `getDb(SHARED_WORKSPACE_ID)`.

That single change is the entire behavioral difference. Every page, API route,
report, backup and import already resolves its database through that function,
so all of them become per-account with no further edits. `getDb`
(`connection.ts:266-275`) already creates `data/ws/<userId>.db` on first access
via `createDb`, so a new account's workspace appears on first login — schema
created, migrations applied — with no provisioning step.

### 2. Account lifecycle

- **Create:** adding a user in Settings → Users grants a private empty workspace,
  materialised on their first authenticated request.
- **Delete:** `deleteUser` (`src/lib/auth/users.ts:34-36`) removes only the
  registry row. **The workspace file is deliberately left on disk.** A row delete
  silently destroying a business's books is a worse failure than an orphaned file
  an admin can remove on purpose.
- **No id reuse:** `users.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`
  (`users-db.ts:9`), so SQLite never reissues an id. A new account cannot inherit
  a deleted account's database.

### 3. What is removed

- `SHARED_WORKSPACE_ID` and `tests/lib/db/shared-workspace.test.ts`.
- In `src/app/api/setup/route.ts`: the `adoptLegacyDb(SHARED_WORKSPACE_ID)` and
  `getDb(SHARED_WORKSPACE_ID)` calls. The first admin gets their own workspace
  like everyone else, on first request.
- `adoptLegacyDb` itself (`connection.ts:279-287`) loses its only caller. It
  exists to adopt a pre-multitenant `data/whatnot.db`; the owner is re-uploading
  via Excel, so it is dead weight. Remove it and its `copyFileSync`/`existsSync`
  imports if they become unused.

`workspacePath(userId)` stays exactly as it is — it already maps an id to
`data/ws/<id>.db` and is what makes this work.

### 4. Re-uploading data

Each account logs in and imports its own Excel through Settings → Backup. The
legacy importer writes to `dbForRequest()`, so it lands in that account's own
database. No per-account import work is needed.

## Testing

Isolation is the guarantee, so it gets a real test rather than an assertion:

- Two users resolve to **different** workspace paths, and `workspacePath(1)` ends
  in `/ws/1.db`.
- An item inserted into user 1's workspace is **absent** from user 2's, and vice
  versa — asserted against two live databases, not mocked.
- A freshly created account's workspace opens with zero inventory items,
  invoices and ledger rows, and with the schema present (a domain query runs
  without throwing).
- `getDb` returns the same handle for repeated calls with one id, and distinct
  handles for different ids.

The existing suite (410 tests) must stay green — nothing else should care.

Verify with `npm test` and `npm run build`, then smoke on a dev copy: log in as
two accounts, add an item as one, confirm the other cannot see it.

## Risks

- **Data appears to vanish on deploy.** The moment this ships, every account
  stops seeing `ws/0.db` and starts seeing its own file. That is the intended
  behavior, but to a user it looks like the app was wiped. The owner has accepted
  this and is re-uploading.
- **Orphaned files persist.** `ws/0.db` and any deleted account's file remain on
  disk, serving nobody. Deliberate — recoverable clutter beats irreversible loss.
- **Export before deleting.** Once `ws/*.db` files are removed there is no undo.
  Each account's Excel export must be downloaded *and opened* to confirm it is
  readable before anything is deleted.
- **Disk growth.** One SQLite file per account. At the stated scale (a handful of
  known users) this is immaterial.
