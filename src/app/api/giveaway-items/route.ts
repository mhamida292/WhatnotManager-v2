import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import {
  listGiveawayItems, insertGiveawayItem, updateGiveawayItem,
  giveawayItemUsageCount, deleteGiveawayItem,
} from "@/lib/db/giveaway-items";

export async function GET() {
  return NextResponse.json(listGiveawayItems(await dbForRequest()));
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const packCostCents = Number(b.packCostCents);
  const packQty = Number(b.packQty);
  if (!name || !Number.isFinite(packCostCents) || packCostCents < 0 ||
      !Number.isInteger(packQty) || packQty < 1) {
    return NextResponse.json({ error: "Invalid giveaway item" }, { status: 400 });
  }
  const id = insertGiveawayItem(await dbForRequest(), { name, packCostCents, packQty });
  return NextResponse.json({ id });
}

export async function PUT(req: NextRequest) {
  const b = await req.json();
  const id = Number(b.id);
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const packCostCents = Number(b.packCostCents);
  const packQty = Number(b.packQty);
  if (!Number.isInteger(id) || !name || !Number.isFinite(packCostCents) || packCostCents < 0 ||
      !Number.isInteger(packQty) || packQty < 1) {
    return NextResponse.json({ error: "Invalid giveaway item" }, { status: 400 });
  }
  updateGiveawayItem(await dbForRequest(), { id, name, packCostCents, packQty, active: Boolean(b.active) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const db = await dbForRequest();
  const usage = giveawayItemUsageCount(db, id);
  if (usage > 0) {
    return NextResponse.json(
      { error: `Used in ${usage} show${usage === 1 ? "" : "s"} — deactivate instead to preserve history.` },
      { status: 409 },
    );
  }
  deleteGiveawayItem(db, id);
  return NextResponse.json({ ok: true });
}
