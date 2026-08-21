import type { DB } from "./connection";

export type CostingMode = "per_sku" | "pooled";
export type AvgMethod = "live" | "moving";

export interface Settings {
  ownerSharePct: number;
  giveawayUnitCents: number;
  defaultShippingSuppliesCents: number;
  businessName: string | null;
  invoicePhone: string | null;
  invoiceAddress: string | null;
  invoiceEmail: string | null;
  invoiceShowPhone: boolean;
  invoiceShowAddress: boolean;
  invoiceShowEmail: boolean;
  whatnotOnly: boolean;
  costingMode: CostingMode;
  avgMethod: AvgMethod;
}

export function getSettings(db: DB): Settings {
  const r = db.prepare(`SELECT owner_share_pct as ownerSharePct,
    giveaway_unit_cents as giveawayUnitCents,
    default_shipping_supplies_cents as defaultShippingSuppliesCents,
    business_name as businessName,
    invoice_phone as invoicePhone, invoice_address as invoiceAddress, invoice_email as invoiceEmail,
    invoice_show_phone as invoiceShowPhone, invoice_show_address as invoiceShowAddress, invoice_show_email as invoiceShowEmail,
    whatnot_only as whatnotOnly,
    costing_mode as costingMode, avg_method as avgMethod
    FROM app_settings WHERE id = 1`).get() as (Omit<Settings, "invoiceShowPhone"|"invoiceShowAddress"|"invoiceShowEmail"|"whatnotOnly"> & { invoiceShowPhone: number; invoiceShowAddress: number; invoiceShowEmail: number; whatnotOnly: number }) | undefined;
  if (!r) throw new Error("app_settings row is missing");
  return { ...r, invoiceShowPhone: !!r.invoiceShowPhone, invoiceShowAddress: !!r.invoiceShowAddress, invoiceShowEmail: !!r.invoiceShowEmail, whatnotOnly: !!r.whatnotOnly };
}

export function updateSettings(db: DB, s: Settings): void {
  db.prepare(`UPDATE app_settings SET owner_share_pct = ?,
    giveaway_unit_cents = ?, default_shipping_supplies_cents = ?, business_name = ?,
    invoice_phone = ?, invoice_address = ?, invoice_email = ?,
    invoice_show_phone = ?, invoice_show_address = ?, invoice_show_email = ?,
    whatnot_only = ?, costing_mode = ?, avg_method = ?
    WHERE id = 1`)
    .run(s.ownerSharePct, s.giveawayUnitCents, s.defaultShippingSuppliesCents, s.businessName,
      s.invoicePhone ?? null, s.invoiceAddress ?? null, s.invoiceEmail ?? null,
      s.invoiceShowPhone ? 1 : 0, s.invoiceShowAddress ? 1 : 0, s.invoiceShowEmail ? 1 : 0,
      s.whatnotOnly ? 1 : 0, s.costingMode, s.avgMethod);
}
