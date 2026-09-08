import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { getSettings, updateSettings } from "@/lib/db/settings";
import { itemsWithWarehouseStock } from "@/lib/db/inventory";

export async function GET() {
  return NextResponse.json(getSettings(await dbForRequest()));
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const defaultShippingSuppliesCents = Number(body.defaultShippingSuppliesCents);
  if (!Number.isFinite(defaultShippingSuppliesCents) || defaultShippingSuppliesCents < 0) {
    return NextResponse.json({ error: "Invalid settings values" }, { status: 400 });
  }
  const db = await dbForRequest();
  const currentSettings = getSettings(db);
  const { giveawayUnitCents, whatnotOnly: wasWhatnotOnly, costingMode: wasCostingMode, avgMethod: wasAvgMethod } = currentSettings;
  const whatnotOnly = typeof body.whatnotOnly === "boolean" ? body.whatnotOnly : wasWhatnotOnly;
  const costingMode = body.costingMode === "per_sku" || body.costingMode === "pooled" ? body.costingMode : wasCostingMode;
  const avgMethod = body.avgMethod === "live" || body.avgMethod === "moving" ? body.avgMethod : wasAvgMethod;
  if (whatnotOnly && !wasWhatnotOnly) {
    const blockers = itemsWithWarehouseStock(db);
    if (blockers.length > 0) {
      return NextResponse.json({ error: "Warehouse stock remains", items: blockers }, { status: 409 });
    }
  }
  const trimOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const businessName = trimOrNull(body.businessName);
  const invoicePhone = trimOrNull(body.invoicePhone);
  const invoiceAddress = trimOrNull(body.invoiceAddress);
  const invoiceEmail = trimOrNull(body.invoiceEmail);
  updateSettings(db, {
    giveawayUnitCents, defaultShippingSuppliesCents, businessName,
    invoicePhone, invoiceAddress, invoiceEmail,
    invoiceShowPhone: body.invoiceShowPhone !== false,
    invoiceShowAddress: body.invoiceShowAddress !== false,
    invoiceShowEmail: body.invoiceShowEmail !== false,
    whatnotOnly, costingMode, avgMethod,
  });
  return NextResponse.json({ ok: true });
}
