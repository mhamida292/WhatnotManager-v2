import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { getSettings, updateSettings } from "@/lib/db/settings";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("settings", () => {
  it("returns the seeded defaults", () => {
    expect(getSettings(db)).toEqual({ giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving",
    });
  });

  it("updates and reads back", () => {
    updateSettings(db, { giveawayUnitCents: 400, defaultShippingSuppliesCents: 250, businessName: "DirectDealzz",
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "pooled", avgMethod: "live",
    });
    expect(getSettings(db)).toEqual({ giveawayUnitCents: 400, defaultShippingSuppliesCents: 250, businessName: "DirectDealzz",
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "pooled", avgMethod: "live",
    });
  });
});

describe("invoice contact settings", () => {
  it("defaults contact fields null and show-flags true", () => {
    const db = createDb(":memory:");
    const s = getSettings(db);
    expect(s.invoicePhone).toBeNull();
    expect(s.invoiceAddress).toBeNull();
    expect(s.invoiceEmail).toBeNull();
    expect(s.invoiceShowPhone).toBe(true);
    expect(s.invoiceShowAddress).toBe(true);
    expect(s.invoiceShowEmail).toBe(true);
  });
  it("round-trips contact fields and show-flags", () => {
    const db = createDb(":memory:");
    updateSettings(db, {
      ...getSettings(db),
      invoicePhone: "(313) 555-0142", invoiceAddress: "123 Warehouse Ave", invoiceEmail: "b@x.com",
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: false,
    });
    const s = getSettings(db);
    expect(s).toMatchObject({
      invoicePhone: "(313) 555-0142", invoiceAddress: "123 Warehouse Ave", invoiceEmail: "b@x.com",
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: false, whatnotOnly: false,
    });
  });
});
