import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { listItems } from "@/lib/db/inventory";
import {
  listShowSaleLines, getShowBundles, setShowBundles, type BundleInput,
} from "@/lib/db/bundles";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showId = Number(id);
  const db = await dbForRequest();
  return NextResponse.json({
    saleLines: listShowSaleLines(db, showId),
    items: listItems(db).map((i) => ({ id: i.id, name: i.name, unitCostCents: i.unitCostCents })),
    bundles: getShowBundles(db, showId),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showId = Number(id);
  const body = await req.json();
  const raw = Array.isArray(body.bundles) ? body.bundles : [];
  const bundles: BundleInput[] = [];
  for (const b of raw) {
    const ledgerTxnId = Number(b.ledgerTxnId);
    if (!Number.isInteger(ledgerTxnId)) {
      return NextResponse.json({ error: "Invalid bundle" }, { status: 400 });
    }
    const rawComps = Array.isArray(b.components) ? b.components : [];
    const components = [];
    for (const c of rawComps) {
      const itemId = Number(c.itemId);
      const qty = Number(c.qty);
      if (!Number.isInteger(itemId) || !Number.isInteger(qty) || qty < 0) {
        return NextResponse.json({ error: "Invalid component" }, { status: 400 });
      }
      if (qty > 0) components.push({ itemId, qty });
    }
    if (components.length > 0) bundles.push({ ledgerTxnId, components });
  }
  setShowBundles(await dbForRequest(), showId, bundles);
  return NextResponse.json({ ok: true });
}
