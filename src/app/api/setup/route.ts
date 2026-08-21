import { NextRequest, NextResponse } from "next/server";
import { getUsersDb } from "@/lib/auth/users-db";
import { adminExists, createUser } from "@/lib/auth/users";
import { setSessionCookie } from "@/lib/auth/request";

export async function POST(req: NextRequest) {
  const reg = getUsersDb();
  if (adminExists(reg)) return NextResponse.json({ error: "Already set up" }, { status: 409 });
  const { username, password } = await req.json();
  if (!username || !password) return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  if (adminExists(reg)) return NextResponse.json({ error: "Already set up" }, { status: 409 });
  const id = createUser(reg, { username, password, isAdmin: true });
  await setSessionCookie(id);
  return NextResponse.json({ ok: true });
}
