import { describe, it, expect } from "vitest";
import { createDb, migrate } from "@/lib/db/connection";
import { getSettings, updateSettings } from "@/lib/db/settings";

describe("whatnotOnly setting", () => {
  it("defaults to false on a fresh db", () => {
    const db = createDb(":memory:");
    expect(getSettings(db).whatnotOnly).toBe(false);
  });

  it("round-trips through updateSettings", () => {
    const db = createDb(":memory:");
    updateSettings(db, { ...getSettings(db), whatnotOnly: true });
    expect(getSettings(db).whatnotOnly).toBe(true);
    updateSettings(db, { ...getSettings(db), whatnotOnly: false });
    expect(getSettings(db).whatnotOnly).toBe(false);
  });

  it("migrate adds the column to a legacy app_settings table and is idempotent", () => {
    const db = createDb(":memory:");
    db.exec("ALTER TABLE app_settings DROP COLUMN whatnot_only");
    migrate(db);
    migrate(db);
    expect(getSettings(db).whatnotOnly).toBe(false);
  });
});
