import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { setItemRemaining } from "@/lib/db/inventory";
import type { AdjustReason } from "@/lib/db/adjustments";

const VALID_REASONS: AdjustReason[] = ["sample", "damage_loss", "recount", "other"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const itemId = Number((await params).id);
  const b = await req.json();
  const counted = Number(b.counted);
  if (!Number.isInteger(counted) || counted < 0) return NextResponse.json({ error: "counted must be a non-negative integer" }, { status: 400 });
  const reason: AdjustReason = VALID_REASONS.includes(b.reason) ? b.reason : "recount";
  const on = typeof b.on === "string" && b.on ? b.on : undefined;
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  setItemRemaining(await dbForRequest(), itemId, counted, { reason, note, on });
  return NextResponse.json({ ok: true });
}
