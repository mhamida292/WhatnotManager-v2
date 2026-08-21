import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { applyCount } from "@/lib/db/inventory";
import type { AdjustReason } from "@/lib/db/adjustments";

const VALID_REASONS: AdjustReason[] = ["sample", "damage_loss", "recount", "other"];

export async function POST(req: NextRequest) {
  const b = await req.json();
  const on = typeof b.on === "string" && b.on ? b.on : new Date().toISOString().slice(0, 10);
  const rawRows: unknown[] = Array.isArray(b.rows) ? b.rows : [];
  const rows: { itemId: number; counted: number; reason?: AdjustReason }[] = [];
  for (const rr of rawRows) {
    const r = rr as { itemId?: unknown; counted?: unknown; reason?: unknown };
    const itemId = Number(r.itemId);
    const counted = Number(r.counted);
    if (!Number.isInteger(itemId) || !Number.isInteger(counted) || counted < 0) {
      return NextResponse.json({ error: "each row needs an integer itemId and a non-negative integer counted" }, { status: 400 });
    }
    const reason = VALID_REASONS.includes(r.reason as AdjustReason) ? (r.reason as AdjustReason) : "recount";
    rows.push({ itemId, counted, reason });
  }
  applyCount(await dbForRequest(), on, rows);
  return NextResponse.json({ ok: true });
}
