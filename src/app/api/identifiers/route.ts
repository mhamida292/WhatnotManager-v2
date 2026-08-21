import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { addIdentifier, removeAlias } from "@/lib/db/aliases";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const itemId = Number(b.itemId);
  const source = b.source === "supplier" || b.source === "whatnot" ? b.source : null;
  if (!Number.isInteger(itemId) || !source || typeof b.code !== "string")
    return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  const r = addIdentifier(await dbForRequest(), {
    itemId, source, code: b.code,
    supplierLabel: typeof b.supplierLabel === "string" ? b.supplierLabel : null,
  });
  if (!r.ok) {
    const msg = r.reason === "duplicate" ? "That code is already used by another item" : "Enter a code";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: r.id });
}

export async function DELETE(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = await dbForRequest();
  const row = db.prepare("SELECT source FROM item_identifiers WHERE id = ?").get(id) as { source: string } | undefined;
  if (row?.source === "mine") return NextResponse.json({ error: "Cannot remove the item's own SKU" }, { status: 400 });
  removeAlias(db, id);
  return NextResponse.json({ ok: true });
}
