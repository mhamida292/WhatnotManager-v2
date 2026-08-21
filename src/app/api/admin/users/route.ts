// src/app/api/admin/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/request";
import { getUsersDb } from "@/lib/auth/users-db";
import { listUsers, createUser } from "@/lib/auth/users";

export async function GET() {
  await requireAdmin();
  return NextResponse.json(listUsers(getUsersDb()));
}

export async function POST(req: NextRequest) {
  await requireAdmin();
  const { username, password } = await req.json();
  if (!username || !password) return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  try {
    const id = createUser(getUsersDb(), { username, password, isAdmin: false });
    return NextResponse.json({ id });
  } catch {
    return NextResponse.json({ error: "That username is taken" }, { status: 409 });
  }
}
