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
  const u = await requireUser();
  return getDb(u.id);
}

export async function setSessionCookie(userId: number): Promise<void> {
  const token = signSession(userId, appSecret(getUsersDb()));
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
