import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { saveShow, listShows, deleteShow } from "@/lib/db/shows";

export async function GET() {
  return NextResponse.json(listShows(await dbForRequest()));
}
export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = saveShow(await dbForRequest(), body);
  return NextResponse.json({ id });
}
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = await dbForRequest();
  const exists = db.prepare("SELECT 1 FROM shows WHERE id = ?").get(id);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  deleteShow(db, id);
  return NextResponse.json({ ok: true });
}
