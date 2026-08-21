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
