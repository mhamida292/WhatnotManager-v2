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

/**
 * The stand-in value `docker-compose.yml` used to substitute when the host had no
 * APP_SECRET set. It is public (it lives in this repo), so a session signed with it
 * is forgeable by anyone who can reach the port. Never accept it as a real secret.
 */
export const PLACEHOLDER_APP_SECRET = "change-me-to-a-long-random-string";

/** Shorter than this and it isn't a random value worth signing sessions with. */
const MIN_APP_SECRET_LENGTH = 16;

export function appSecret(db: DB): string {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv) {
    // Fail closed. Falling back to the persisted secret here would let a
    // misconfigured deploy keep running while looking healthy.
    if (fromEnv === PLACEHOLDER_APP_SECRET) {
      throw new Error(
        "APP_SECRET is still the placeholder value. Session cookies signed with it are " +
        "forgeable by anyone who can reach this app. Set APP_SECRET to a long random " +
        "string (e.g. `openssl rand -hex 32`) in the .env file next to docker-compose.yml.",
      );
    }
    if (fromEnv.length < MIN_APP_SECRET_LENGTH) {
      throw new Error(
        `APP_SECRET is too short (${fromEnv.length} chars, minimum ${MIN_APP_SECRET_LENGTH}). ` +
        "Set it to a long random string (e.g. `openssl rand -hex 32`).",
      );
    }
    return fromEnv;
  }
  const row = db.prepare("SELECT value FROM app_meta WHERE key='app_secret'").get() as { value: string } | undefined;
  if (row) return row.value;
  const secret = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO app_meta (key, value) VALUES ('app_secret', ?)").run(secret);
  return secret;
}
