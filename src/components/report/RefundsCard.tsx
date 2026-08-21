import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Money } from "@/components/Money";
import type { RefundRow } from "@/lib/db/ledger-refunds";

export function RefundsCard({ refunds, totalCents }: { refunds: RefundRow[]; totalCents: number }) {
  if (refunds.length === 0) return null;
  return (
    <Card title={<div className="flex justify-between"><span>Refunds ({refunds.length})</span><span className="normal-case"><Money cents={totalCents} /></span></div>}>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr><th className="py-1 text-left">Date</th><th className="py-1 text-left">Product</th><th className="py-1 text-left">Order #</th><th className="py-1 text-right">Amount</th></tr>
        </thead>
        <tbody>
          {refunds.map((r, i) => (
            <tr key={i} className="border-t border-line">
              <td className="py-1.5 pr-4 text-slate-500">{r.showDate}</td>
              <td className="py-1.5 pr-4">
                {r.isShipping ? <span className="text-slate-500">Return shipping</span>
                  : r.itemId != null ? <Link href={`/inventory/${r.itemId}`} className="text-brand-700 hover:underline">{r.productName}</Link>
                  : <span>{r.productName ?? "Unknown item"}</span>}
              </td>
              <td className="py-1.5 pr-4 text-slate-400">{r.orderId ?? "—"}</td>
              <td className="py-1.5 text-right"><Money cents={r.amountCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
