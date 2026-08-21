import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { archiveItem, unarchiveItem } from "@/lib/db/inventory";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json();
  if (typeof b.archived !== "boolean") return NextResponse.json({ error: "archived must be a boolean" }, { status: 400 });
  const db = await dbForRequest();
  if (b.archived) archiveItem(db, id); else unarchiveItem(db, id);
  return NextResponse.json({ ok: true });
}
