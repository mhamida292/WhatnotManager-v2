import { createHmac, timingSafeEqual } from "node:crypto";

export { SESSION_COOKIE } from "./session-cookie";

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
