import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { addPurchase, updatePurchase, deletePurchase, getPurchaseItemId } from "@/lib/db/purchases";
import { reconcileWhatnotOnly } from "@/lib/db/inventory";

const intId = (v: unknown) => Number.isInteger(Number(v));
const qtyOk = (v: unknown) => Number.isInteger(Number(v)) && Number(v) >= 1;
const costOk = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0;
const dateOk = (v: unknown) => v === null || v === undefined || typeof v === "string";

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!intId(b.itemId)) return NextResponse.json({ error: "Invalid itemId" }, { status: 400 });
  if (!qtyOk(b.quantity) || !costOk(b.unitCostCents) || !dateOk(b.purchasedOn))
    return NextResponse.json({ error: "Invalid purchase" }, { status: 400 });
  const id = addPurchase(await dbForRequest(), {
    itemId: Number(b.itemId), purchasedOn: b.purchasedOn || null,
    quantity: Math.trunc(Number(b.quantity)), unitCostCents: Math.trunc(Number(b.unitCostCents)),
  });
  return NextResponse.json({ id });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!intId(b.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (!qtyOk(b.quantity) || !costOk(b.unitCostCents) || !dateOk(b.purchasedOn))
    return NextResponse.json({ error: "Invalid purchase" }, { status: 400 });
  const db = await dbForRequest();
  // Capture the batch's item BEFORE updatePurchase runs — there is nothing left to
  // look up afterward if the quantity change is what created the drift.
  const itemId = getPurchaseItemId(db, Number(b.id));
  updatePurchase(db, Number(b.id), {
    purchasedOn: b.purchasedOn || null,
    quantity: Math.trunc(Number(b.quantity)), unitCostCents: Math.trunc(Number(b.unitCostCents)),
  });
  // Reconciliation deliberately runs outside updatePurchase's own transaction: widening
  // that transaction to include it would require purchases.ts to import inventory.ts,
  // which would create a purchases -> inventory -> purchases cycle (forbidden). The
  // reconciler is idempotent/self-healing, so a crash between the two calls just means
  // the next reconcile (any call site, or a future edit) closes the gap.
  if (itemId != null) reconcileWhatnotOnly(db, itemId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const b = await req.json();
  if (!intId(b.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = await dbForRequest();
  // Capture the batch's item BEFORE deletePurchase runs — the row is gone afterward.
  const itemId = getPurchaseItemId(db, Number(b.id));
  deletePurchase(db, Number(b.id));
  // See the comment in PATCH above: reconciliation runs outside deletePurchase's
  // transaction to avoid a purchases -> inventory import cycle; it is self-healing.
  if (itemId != null) reconcileWhatnotOnly(db, itemId);
  return NextResponse.json({ ok: true });
}
