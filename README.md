# Warehouse Manager

Self-hosted Next.js + SQLite app to manage warehouse inventory, receiving, payroll,
and expenses (with reimbursement tracking), plus a Whatnot sales aggregator.

## Develop
    npm install
    npm run seed        # loads lots, items, aliases, incentive offset
    npm run dev         # http://localhost:3000

## Test
    npm test
## To do: 
- Add invoice items that don't post to inventory (transaction fee, shipping)
- Add invoice "deductions" that subtract from invoice total.
- Add Total amount spent on specific supplier from invoices
- Add total pieces to invoice
- Add SKU manager
- Add Photo system
- Add solid renaming system for inventory and items in sales / purchases 
- Add notes system 
## Multi-user / Workspaces

Each account has its own isolated database at `data/ws/<userId>.db`; logins both gate access and select the workspace. The app supports multiple users, with each user logging in with a username + password.

### Data Layout

All data lives under the `data/` directory (configurable via `DATA_DIR` env var; defaults to `<cwd>/data`):

- **`data/users.db`** — the user registry (stores accounts: username, password hash, admin flag).
- **`data/ws/<userId>.db`** — one isolated SQLite database **per user**, containing their shows, inventory, ledger, invoices, settings, etc. Created automatically on the user's first access.

### First-Run Setup

On first visit with no users, the app routes to `/setup` to create the **ADMIN account**, which gets its own empty workspace like any other account on first request.

After the admin account exists, they can manage other users at **Settings → Users** (`/settings/users`, admin-only):
- Add a new user
- Reset a user's password
- Delete a user (removes only their login; their `data/ws/<id>.db` is kept on disk)

### Configuration

Set these environment variables:

- **`APP_SECRET`** — A long random string used to sign session cookies. **Required under Docker Compose**, which refuses to start without it; copy `.env.example` to `.env` and fill it in:

      cp .env.example .env
      openssl rand -hex 32        # paste the output as APP_SECRET

  If the variable is left unset entirely (e.g. `npm run dev`), a random secret is generated once and persisted in `data/users.db`, so sessions survive restarts. A placeholder or under-16-character value is rejected outright rather than silently accepted — sessions are `HMAC(userId, APP_SECRET)`, so a guessable secret lets anyone who can reach the port forge an admin cookie. Changing the value invalidates all existing sessions (everyone logs in again).
- **`DATA_DIR`** — Override the data directory path (default: `<cwd>/data`).

### Authentication Notes

The app is intended to run behind a trusted network (e.g., Tailscale) over plain HTTP. Session cookies are `httpOnly` and `SameSite=Lax` but deliberately do **not** set the `Secure` flag, allowing login to work over plain HTTP on the tailnet.

### Backups

- Each workspace can be exported/imported as Excel via the in-app interface.
- For full backup, copy the entire `data/` directory (all workspaces + user registry). All of `data/` is git-ignored.

### Demo account

A populated, non-admin `demo` / `demo` account is available for showing the app
(inventory, multiple shows incl. a same-day two-session split, an itemized
giveaway allocation, an on-screen bundle, and expenses). The data is generated,
not stored in git — run the seed once in the target environment:

    npm run seed:demo

**On the home server:** the Docker image is a pruned standalone build without
`tsx`/`scripts/`, so the seed runs on the **host** (in the cloned repo), not
inside the container. Because `docker-compose.yml` bind-mounts `./data` into the
container, seeding `./data` on the host populates the live app:

    docker compose down              # avoid two writers on the SQLite files
    npm install                      # once, if node deps aren't installed
    npm run seed:demo                # writes into ./data (the container's volume)
    docker compose up -d

Re-running rebuilds the demo workspace from scratch (it only ever touches the
`demo` user's own workspace — never your real accounts/data).

## Deploy (homelab)

Easiest — Docker Compose (persists the `data/` volume across container restarts):

    docker compose up -d --build      # http://<host>:4342

Change the host port in `docker-compose.yml` (`"4342:3000"`) if you want a different one.

Or plain Docker:

    docker build -t whatnot-manager .
    docker run -d -p 3000:3000 -v /your/host/path/data:/app/data whatnot-manager

On a fresh `data/` directory, the app creates and migrates the schema automatically on first run.

## Workflow
1. Inventory page: add items, map Whatnot product names to items.
2. Shows page: upload the Whatnot CSV, review auto-classified rows, enter payout + shipping supplies, save.
3. Dashboard: net profit, your 80% share, inventory spend, expenses.
