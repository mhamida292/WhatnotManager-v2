import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { listAdjustments, addAdjustment, deleteAdjustment, type AdjustReason } from "@/lib/db/adjustments";
import { reconcileWhatnotOnly } from "@/lib/db/inventory";

const VALID_REASONS: AdjustReason[] = ["sample", "damage_loss", "recount", "other"];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const itemId = Number((await params).id);
  const db = await dbForRequest();
  return NextResponse.json(listAdjustments(db, itemId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const itemId = Number((await params).id);
  const body = await req.json();
  const reason: AdjustReason = body.reason;
  const qty = Number(body.qty);
  if (!VALID_REASONS.includes(reason)) return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  if (!Number.isInteger(qty) || qty === 0) return NextResponse.json({ error: "qty must be a non-zero integer" }, { status: 400 });
  const channel = body.channel === "whatnot" ? "whatnot" : "warehouse";
  const db = await dbForRequest();
  const id = addAdjustment(db, {
    itemId,
    adjustedOn: typeof body.adjustedOn === "string" && body.adjustedOn ? body.adjustedOn : null,
    reason,
    qty,
    note: typeof body.note === "string" && body.note ? body.note : null,
    counted: Number.isInteger(Number(body.counted)) ? Number(body.counted) : null,
    channel,
  });
  return NextResponse.json({ id });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const itemId = Number((await ctx.params).id);
  const body = await req.json();
  const adjId = Number(body.adjId);
  if (!Number.isInteger(adjId) || adjId <= 0) return NextResponse.json({ error: "Invalid adjId" }, { status: 400 });
  const db = await dbForRequest();
  deleteAdjustment(db, adjId);
  // Reconciliation deliberately runs outside deleteAdjustment's own transaction: widening
  // that transaction to include it would require adjustments.ts to import inventory.ts,
  // which would create an adjustments -> inventory -> adjustments cycle (forbidden, since
  // inventory.ts already imports adjustments.ts). The reconciler is idempotent/self-healing,
  // so a crash between the two calls just means the next reconcile (any call site, or a
  // future edit) closes the gap. See src/app/api/purchases/route.ts for the same pattern.
  if (Number.isInteger(itemId)) reconcileWhatnotOnly(db, itemId);
  return NextResponse.json({ ok: true });
}
