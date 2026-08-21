import Link from "next/link";
import { Money } from "@/components/Money";

export interface PurchaseRow { id: number; purchasedOn: string | null; quantity: number; unitCostCents: number; invoiceId?: number | null; invoiceNumber?: string | null; }

/** Read-only purchase-batch table with a weighted-average + total footer.
 *  Pass onEdit/onDelete to show per-row controls (used inside the Edit modal). */
export function PurchaseList({ purchases, onEdit, onDelete }: {
  purchases: PurchaseRow[];
  onEdit?: (p: PurchaseRow) => void;
  onDelete?: (id: number) => void;
}) {
  const qty = purchases.reduce((s, p) => s + p.quantity, 0);
  const spend = purchases.reduce((s, p) => s + p.quantity * p.unitCostCents, 0);
  const avg = qty > 0 ? Math.round(spend / qty) : 0;
  const editable = !!(onEdit || onDelete);

  if (purchases.length === 0) return <p className="text-sm text-slate-500">No purchases recorded yet.</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-slate-400">
          <th className="py-1">Date</th>
          <th className="py-1 text-right">Qty</th>
          <th className="py-1 text-right">Unit cost</th>
          <th className="py-1 text-right">Total</th>
          <th className="py-1">Source</th>
          {editable && <th className="py-1" />}
        </tr>
      </thead>
      <tbody>
        {purchases.map((p) => (
          <tr key={p.id} className="border-t border-line">
            <td className="py-1.5">{p.purchasedOn ?? "—"}</td>
            <td className="py-1.5 text-right tabular-nums">{p.quantity}</td>
            <td className="py-1.5 text-right tabular-nums"><Money cents={p.unitCostCents} /></td>
            <td className="py-1.5 text-right tabular-nums"><Money cents={p.quantity * p.unitCostCents} /></td>
            <td className="py-1.5 text-xs">
              {p.invoiceId ? <Link href={`/invoices/${p.invoiceId}`} className="text-emerald-700 hover:underline">{p.invoiceNumber}</Link> : <span className="text-slate-400">—</span>}
            </td>
            {editable && (
              <td className="py-1.5 text-right whitespace-nowrap">
                {onEdit && <button onClick={() => onEdit(p)} className="text-xs text-emerald-700 hover:underline">edit</button>}
                {onDelete && <button onClick={() => onDelete(p.id)} className="ml-2 text-xs text-red-600 hover:underline">✕</button>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-line font-medium">
          <td className="py-1.5 text-slate-500">Purchased {qty}</td>
          <td />
          <td className="py-1.5 text-right text-slate-500">Avg <Money cents={avg} /></td>
          <td className="py-1.5 text-right"><Money cents={spend} /></td>
          <td />
          {editable && <td />}
        </tr>
      </tfoot>
    </table>
  );
}
