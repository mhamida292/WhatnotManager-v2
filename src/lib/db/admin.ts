import type { DB } from "./connection";

/**
 * Factory reset: wipe ALL user data and restore default settings.
 * Deletes are ordered child-before-parent so foreign keys stay satisfied.
 */
export function resetApp(db: DB): void {
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM bundle_components;
      DELETE FROM ledger_transactions;
      DELETE FROM show_line_items;
      DELETE FROM shows;
      DELETE FROM expenses;
      DELETE FROM item_identifiers;
      DELETE FROM inventory_items;
      DELETE FROM lots;
    `);
    db.prepare(`UPDATE app_settings SET owner_share_pct = 80,
      giveaway_unit_cents = 500, default_shipping_supplies_cents = 0 WHERE id = 1`).run();
  });
  tx();
}
