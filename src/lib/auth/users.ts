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
