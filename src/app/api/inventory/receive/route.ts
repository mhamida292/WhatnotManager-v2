import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { addPurchase } from "@/lib/db/purchases";

export async function POST(req: NextRequest) {
  const db = await dbForRequest();
  const body = await req.json();
  const itemId = Number(body.itemId);
  const quantity = Math.trunc(Number(body.quantity));
  const unitCostCents = Math.trunc(Number(body.unitCostCents));
  if (!Number.isInteger(itemId)) return NextResponse.json({ error: "Invalid item" }, { status: 400 });
  if (!(quantity >= 1)) return NextResponse.json({ error: "Quantity must be >= 1" }, { status: 400 });
  if (!(unitCostCents >= 0)) return NextResponse.json({ error: "Invalid unit cost" }, { status: 400 });
  const exists = db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(itemId);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const id = addPurchase(db, { itemId, purchasedOn: body.purchasedOn || null, quantity, unitCostCents });
  return NextResponse.json({ id });
}
