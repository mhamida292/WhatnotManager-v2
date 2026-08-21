import { NextRequest, NextResponse } from "next/server";
import { getUsersDb } from "@/lib/auth/users-db";
import { verifyLogin } from "@/lib/auth/users";
import { setSessionCookie } from "@/lib/auth/request";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  const user = verifyLogin(getUsersDb(), username ?? "", password ?? "");
  if (!user) return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}
