import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import {
  listGiveawayItems, getAllocations, setAllocations, type Allocation,
} from "@/lib/db/giveaway-items";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showId = Number(id);
  const db = await dbForRequest();
  return NextResponse.json({
    items: listGiveawayItems(db, { activeOnly: true }),
    allocations: getAllocations(db, showId),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showId = Number(id);
  const body = await req.json();
  const raw = Array.isArray(body.allocations) ? body.allocations : [];
  const allocations: Allocation[] = [];
  for (const a of raw) {
    const giveawayItemId = Number(a.giveawayItemId);
    const count = Number(a.count);
    if (!Number.isInteger(giveawayItemId) || !Number.isInteger(count) || count < 0) {
      return NextResponse.json({ error: "Invalid allocation" }, { status: 400 });
    }
    if (count > 0) allocations.push({ giveawayItemId, count });
  }
  setAllocations(await dbForRequest(), showId, allocations);
  return NextResponse.json({ ok: true });
}
