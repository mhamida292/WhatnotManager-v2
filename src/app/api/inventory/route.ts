import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { createItemWithFirstPurchase, deleteItem, insertLot, listItems, qtyRemaining, qtySold, renameItem, setItemLocation, setSku } from "@/lib/db/inventory";

export async function GET() {
  const db = await dbForRequest();
  const items = listItems(db).map((i) => ({ ...i, sold: qtySold(db, i.id), qtyRemaining: qtyRemaining(db, i.id) }));
  return NextResponse.json(items);
}
export async function POST(req: NextRequest) {
  const db = await dbForRequest();
  const body = await req.json();
  if (body.kind === "lot") return NextResponse.json({ id: insertLot(db, body) });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const qtyOk = Number.isInteger(Number(body.quantity)) && Number(body.quantity) >= 1;
  const costOk = Number.isFinite(Number(body.unitCostCents)) && Number(body.unitCostCents) >= 0;
  if (!name || !qtyOk || !costOk) return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  const id = createItemWithFirstPurchase(db, {
    name, lotId: body.lotId ?? null, purchasedOn: body.purchasedOn || null,
    quantity: Math.trunc(Number(body.quantity)), unitCostCents: Math.trunc(Number(body.unitCostCents)),
  });
  return NextResponse.json({ id });
}
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = await dbForRequest();
  const valid = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0;

  if (body.name !== undefined) {
    if (typeof body.name !== "string") return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    const r = renameItem(db, id, body.name);
    if (!r.ok) {
      if (r.reason === "duplicate") return NextResponse.json({ error: "An item with that name already exists" }, { status: 409 });
      if (r.reason === "empty") return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  if (body.sku !== undefined) {
    if (typeof body.sku !== "string") return NextResponse.json({ error: "Invalid sku" }, { status: 400 });
    const r = setSku(db, id, body.sku);
    if (!r.ok) {
      if (r.reason === "duplicate") return NextResponse.json({ error: "That SKU is already used by another item" }, { status: 409 });
      if (r.reason === "not_found") return NextResponse.json({ error: "Item not found" }, { status: 404 });
      return NextResponse.json({ error: "Enter a SKU" }, { status: 400 });
    }
  }

  if (body.location !== undefined) {
    if (body.location !== null && typeof body.location !== "string")
      return NextResponse.json({ error: "Invalid location" }, { status: 400 });
    setItemLocation(db, id, body.location);
  }

  return NextResponse.json({ ok: true });
}
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = await dbForRequest();
  const exists = db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(id);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  deleteItem(db, id);
  return NextResponse.json({ ok: true });
}
