import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { mergeItems } from "@/lib/db/inventory";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const loserId = Number(b.loserId);
  const survivorId = Number(b.survivorId);
  if (!Number.isInteger(loserId) || !Number.isInteger(survivorId))
    return NextResponse.json({ error: "Invalid merge" }, { status: 400 });
  const r = mergeItems(await dbForRequest(), { loserId, survivorId });
  if (!r.ok) {
    const msg =
      r.reason === "same_item" ? "Cannot merge an item into itself" :
      r.reason === "survivor_archived" ? "Cannot merge into an archived item" :
      "Item not found";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
