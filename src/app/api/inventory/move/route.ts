import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { addMove } from "@/lib/db/moves";
import { getSettings } from "@/lib/db/settings";

export async function POST(req: NextRequest) {
  const db = await dbForRequest();
  if (getSettings(db).whatnotOnly) {
    return NextResponse.json({ error: "Whatnot-only mode is on — turn it off in Settings to move stock." }, { status: 409 });
  }
  const body = await req.json();
  const itemId = Number(body.itemId);
  const quantity = Math.trunc(Number(body.quantity));
  const direction = body.direction === "to_warehouse" ? "to_warehouse" : body.direction === "to_whatnot" ? "to_whatnot" : null;
  if (!Number.isInteger(itemId)) return NextResponse.json({ error: "Invalid item" }, { status: 400 });
  if (!(quantity >= 1)) return NextResponse.json({ error: "Quantity must be >= 1" }, { status: 400 });
  if (!direction) return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
  const exists = db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(itemId);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const id = addMove(db, { itemId, qty: quantity, direction, movedOn: body.movedOn || null });
  return NextResponse.json({ id });
}
