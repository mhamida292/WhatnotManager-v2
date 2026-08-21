# Mac desktop app for the brother (Electron) — design

**Date:** 2026-06-22
**Status:** PARKED — design approved-in-principle; revisit to finalize + write the implementation plan.

## Background / how we got here

The user wants "a version of this app for my brother, who doesn't know how to
deploy applications." We explored the option space:

- **Path A — host a private copy for him** (homelab + Cloudflare Tunnel, or a
  managed host like Fly.io/Railway ~$3–5/mo). Solves "can't deploy" by the user
  hosting it. No app rewrite.
- **Path B — true multi-tenant app** (auth + per-user data isolation across all
  48 `getDb()` call sites + cloud hosting). A large multi-subsystem build. **Set
  aside** — overkill for one sibling; only worth it to build a real multi-user
  SaaS.
- **Chosen: run it on his own computer as a double-click desktop app.** No
  hosting, no monthly cost, no uptime/tunnel dependency, fully private (data
  never leaves his Mac). This is the direction to build.

## Decisions locked in

- **Packaging:** Electron (the app is Next.js server + native `better-sqlite3`;
  Electron bundles a runtime and handles the native module — Tauri and a
  bundled-node-script were rejected).
- **Target:** macOS, **Apple Silicon (arm64)**.
- **Signing:** ship **unsigned**; first launch is **right-click → Open** once
  (free). A $99/yr Apple Developer account for seamless signing is a possible
  later upgrade, not now.
- **First run:** starts with an **empty database** (his own books); he can pull
  data in via the existing Excel import.
- **Auto-update:** out of scope for v1 (rebuild `.dmg` and send him the new one).

## Design

**Architecture.** A thin Electron shell in a new `electron/` folder; the web app
code is untouched. On launch the shell:
1. Sets `DB_PATH` to `~/Library/Application Support/WhatNot Manager/whatnot.db`
   (per-user, writable, survives app updates — the web app already reads
   `process.env.DB_PATH`, so no app change needed).
2. Boots the existing Next standalone server (`.next/standalone/server.js`,
   produced by `output: "standalone"`) on a local port inside Electron's
   runtime.
3. Waits for it to be ready, then opens a `BrowserWindow` at
   `http://localhost:<port>`.
4. On quit, runs the existing WAL `checkpointAndClose` so the DB file is clean.

**Files (new, additive):**
- `electron/main.js` — shell: set `DB_PATH`, start the server, manage window +
  lifecycle, wait-for-ready.
- `electron-builder` config + `package.json` scripts (e.g. `build:desktop`).
- `docs/INSTALL-MAC.md` — illustrated "right-click → Open the first time" note.

**Distribution.** `electron-builder` → unsigned **arm64 `.dmg`**. Send the file;
he drags to Applications, right-click → Open once.

**Compatibility.** Purely additive — the homelab Docker deployment is unaffected.

## The main risk (front-load in the plan)

`better-sqlite3` is a native module that must be rebuilt for Electron's runtime.
`electron-builder` does this automatically, but it's the likeliest thing to need
fixing. **Plan step 1 = prove the packaged app launches and writes to the
Application Support DB** before building anything else on top.

## Testing

- The app's 149 existing tests cover all business logic (unchanged).
- Shell verification is a build-and-run smoke test: produce the `.dmg`, launch
  it, confirm the window loads and that adding data writes to the Application
  Support DB file (not inside the app bundle).

## Open items to confirm when we resume

- Confirm the empty-start and no-auto-update assumptions still hold.
- App display name / icon.
- Whether to also produce a build for the user's own Mac (could replace the
  homelab for him too), and whether an Intel/universal build is ever needed.
