// src/app/api/admin/users/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/request";
import { getUsersDb } from "@/lib/auth/users-db";
import { resetPassword, deleteUser } from "@/lib/auth/users";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  const { password } = await req.json();
  if (!password) return NextResponse.json({ error: "Password required" }, { status: 400 });
  resetPassword(getUsersDb(), id, password);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const id = Number((await params).id);
  if (id === admin.id) return NextResponse.json({ error: "You can't delete yourself" }, { status: 400 });
  deleteUser(getUsersDb(), id);
  return NextResponse.json({ ok: true });
}
