import Link from "next/link";
import { dbForRequest } from "@/lib/auth/request";
import {
  qtySoldFromLedger, qtySoldByItem, qtyRemaining,
  qtySoldWholesale, identifiersForItem, ledgerSalesForItem, deleteImpact, listItems,
} from "@/lib/db/inventory";
import { listAdjustments, sumAdjustments } from "@/lib/db/adjustments";
import { getSettings } from "@/lib/db/settings";
import { Money } from "@/components/Money";
import { itemEarnings } from "@/lib/calc/item-earnings";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { DeleteItemButton } from "@/components/DeleteItemButton";
import { listPurchases } from "@/lib/db/purchases";
import { invoiceNumber } from "@/lib/db/invoices";
import { PurchaseList } from "@/components/PurchaseList";
import { AdjustmentsLog } from "@/components/AdjustmentsLog";
import { QuickRecount } from "@/components/inventory/QuickRecount";
import { ArchiveButton } from "@/components/inventory/ArchiveButton";
import { ItemIdentifiers } from "@/components/inventory/ItemIdentifiers";
import { MergeItemButton } from "@/components/inventory/MergeItemButton";

export const dynamic = "force-dynamic";

export default async function ItemDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = Number(id);
  const db = await dbForRequest();
  const item = db.prepare(
    "SELECT id, name, sku, unit_cost_cents as unitCostCents, qty_purchased as qtyPurchased, archived_at as archivedAt FROM inventory_items WHERE id = ?"
  ).get(itemId) as { id: number; name: string; sku: string | null; unitCostCents: number; qtyPurchased: number; archivedAt: string | null } | undefined;

  if (!item) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Item not found</h1>
        <p className="text-slate-500">It may have been removed by a reset. <Link className="text-emerald-700 hover:underline" href="/inventory">Back to Inventory</Link>.</p>
      </div>
    );
  }

  const ledgerSold = qtySoldFromLedger(db, itemId);
  const legacySold = qtySoldByItem(db, itemId);
  const wholesale = qtySoldWholesale(db, itemId);
  const adjustments = sumAdjustments(db, itemId);
  const remaining = qtyRemaining(db, itemId);
  const identifiers = identifiersForItem(db, itemId);
  const sales = ledgerSalesForItem(db, itemId);
  const earnings = itemEarnings(sales, item.unitCostCents);
  const purchases = listPurchases(db, itemId).map((p) => ({
    id: p.id, purchasedOn: p.purchasedOn, quantity: p.quantity, unitCostCents: p.unitCostCents,
    invoiceId: p.invoiceId, invoiceNumber: p.invoiceId ? invoiceNumber(p.invoiceId) : null,
  }));
  const impact = deleteImpact(db, itemId);
  const others = listItems(db).filter((i) => i.id !== itemId && i.archivedAt == null).map((i) => ({ id: i.id, name: i.name }));
  const initialAdjustments = listAdjustments(db, itemId);
  const { whatnotOnly } = getSettings(db);
  const totalSold = ledgerSold + legacySold + wholesale;

  const summary: [string, React.ReactNode][] = [
    ["Unit cost", <Money cents={item.unitCostCents} />],
    ["Purchased", item.qtyPurchased],
    ["Sold — ledger sales", ledgerSold],
    ["Sold — legacy show sales", legacySold],
    ["Sold — wholesale", wholesale],
    ["Sold — total", totalSold],
    ["Adjustments", <span className={adjustments >= 0 ? "text-emerald-700" : "text-red-600"}>{adjustments >= 0 ? `+${adjustments}` : adjustments}</span>],
    ["Remaining", remaining],
    ["Revenue (ledger sales)", <Money cents={earnings.revenueCents} />],
    ["Cost of units sold", <Money cents={earnings.costCents} />],
    ["Profit", <span className={earnings.profitCents >= 0 ? "text-emerald-700" : "text-red-600"}><Money cents={earnings.profitCents} /></span>],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={<>
          {item.name}
          {item.sku && <div className="text-sm font-mono text-slate-500">SKU: {item.sku}</div>}
        </>}
        subtitle={item.archivedAt ? `Archived ${item.archivedAt} · sales history still counts` : "Sales and Whatnot name mappings for this item"}
        action={
          <div className="flex items-center gap-4">
            <ArchiveButton itemId={item.id} archived={item.archivedAt != null} />
            <Link className="text-sm text-emerald-700 hover:underline" href="/inventory">← Inventory</Link>
          </div>
        } />

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card title="Stock breakdown">
          <table className="w-full text-sm">
            <tbody>{summary.map(([k, v], i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-2 pr-8 text-slate-500">{k}</td>
                <td className="py-2 text-right tabular-nums">{v}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-3 text-xs text-slate-400">Remaining = purchased − sold (all channels) + adjustments.</p>
        </Card>

        <ItemIdentifiers itemId={item.id} sku={item.sku} identifiers={identifiers} />
      </div>

      <Card title={`Purchases (${purchases.length})`}>
        <PurchaseList purchases={purchases} />
      </Card>

      <Card title="Count & adjustments">
        <div className="mb-4 rounded-xl border border-line p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Quick recount</p>
          <QuickRecount itemId={itemId} />
        </div>
        <AdjustmentsLog itemId={itemId} initial={initialAdjustments} whatnotOnly={whatnotOnly} />
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Ledger sales ({sales.length})</h2>
        {sales.length === 0 ? (
          <p className="text-sm text-slate-500">No ledger sales counted toward this item yet.</p>
        ) : (
          <DataTable head={<>
            <th className="px-3 py-2">Show date</th>
            <th className="px-3 py-2">Whatnot product name</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </>}>
            {sales.map((s, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-3 py-2">{s.showDate}</td>
                <td className="px-3 py-2">{s.productName}</td>
                <td className="px-3 py-2 text-right"><Money cents={s.amountCents} /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-600">Danger zone</h2>
        <p className="mb-2 text-xs text-slate-400">
          Deleting unmaps this item&apos;s Whatnot names and removes it from inventory. Sales data is kept; re-add and re-map to restore counts.
        </p>
        <div className="mb-3">
          <p className="mb-1 text-xs text-slate-400">Merge this item into another (fixes a duplicate). This item&apos;s history and identifiers move to the target; this item is deleted.</p>
          <MergeItemButton itemId={item.id} itemName={item.name} others={others} />
        </div>
        <DeleteItemButton id={item.id} name={item.name} impact={impact} />
      </div>
    </div>
  );
}
