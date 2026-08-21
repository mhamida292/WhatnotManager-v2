import { dbForRequest } from "@/lib/auth/request";
import { listItems, qtyRemaining, qtySold, warehouseQty, whatnotQty } from "@/lib/db/inventory";
import { netInventorySpend } from "@/lib/calc/inventory-spend";
import { inStockSummary } from "@/lib/calc/in-stock";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { InventoryForms } from "@/components/InventoryForms";
import { seenProductNames } from "@/lib/db/aliases";
import { getSettings } from "@/lib/db/settings";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Button } from "@/components/ui/Button";
import { InventoryTable } from "@/components/InventoryTable";
import { itemSpendCents, listPurchases } from "@/lib/db/purchases";
import { ArchivedTable } from "@/components/inventory/ArchivedTable";
import { ReceiveStock } from "@/components/inventory/ReceiveStock";
import { buildMapSuggestions } from "@/lib/calc/map-suggestions";
import { UnmappedSuggestions } from "@/components/inventory/UnmappedSuggestions";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const db = await dbForRequest();
  const { whatnotOnly } = getSettings(db);
  const items = listItems(db).map((i) => ({
    ...i, sold: qtySold(db, i.id), remaining: qtyRemaining(db, i.id),
    warehouse: warehouseQty(db, i.id), whatnot: whatnotQty(db, i.id),
  }));
  const active = items.filter((i) => i.archivedAt == null);
  const archived = items.filter((i) => i.archivedAt != null);
  const seen = seenProductNames(db);
  const { unmappedCount, unmappedNames } = buildLedgerReport(db);
  const mapSuggestions = buildMapSuggestions(unmappedNames, active.map((i) => ({ id: i.id, name: i.name })));
  // Stat cards reflect ALL items, archived included — archiving is purely
  // organizational (it hides items from the list/count/mapping, never changes
  // money spent or stock value). Only the table/mapping picker below use `active`.
  const itemCosts = items.map((i) => itemSpendCents(db, i.id));
  const spend = netInventorySpend({ itemCostsCents: itemCosts });
  const stock = inStockSummary(items);

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" subtitle="Items, costs, and what's left to sell"
        action={<Button href="/inventory/count">Count merchandise</Button>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="In stock" value={`${stock.units} units`} />
        <Stat label="In-stock value" value={<Money cents={stock.valueCents} />} />
        <Stat label="Products in stock" value={`${stock.productsInStock} of ${stock.totalProducts}`} />
        <Stat label="True net inventory spend" value={<Money cents={spend} />} />
      </div>

      {unmappedCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {unmappedCount} Whatnot product name(s) aren&apos;t mapped — their sales count at $0 profit. Confirm each below.
        </div>
      )}

      {mapSuggestions.length > 0 && (
        <UnmappedSuggestions suggestions={mapSuggestions} items={active.map((i) => ({ id: i.id, name: i.name }))} />
      )}

      <InventoryTable whatnotOnly={whatnotOnly} items={active.map((i) => ({
        id: i.id, name: i.name, location: i.location, unitCostCents: i.unitCostCents,
        qtyPurchased: i.qtyPurchased, sold: i.sold, remaining: i.remaining,
        warehouse: i.warehouse, whatnot: i.whatnot,
        purchases: listPurchases(db, i.id).map((p) => ({ id: p.id, purchasedOn: p.purchasedOn, quantity: p.quantity, unitCostCents: p.unitCostCents })),
      }))} />

      {archived.length > 0 && (
        <ArchivedTable rows={archived.map((i) => ({ id: i.id, name: i.name, remaining: i.remaining, archivedAt: i.archivedAt }))} />
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start" id="mapping">
        <ReceiveStock items={active.map((i) => ({ id: i.id, name: i.name }))} />
        <InventoryForms items={active.map((i) => ({ id: i.id, name: i.name }))} seenNames={seen} />
      </div>
    </div>
  );
}
