import Link from "next/link";
import { dbForRequest } from "@/lib/auth/request";
import { listInvoices } from "@/lib/db/invoices";
import { Money } from "@/components/Money";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewInvoiceButton } from "@/components/NewInvoiceButton";

export const dynamic = "force-dynamic";

const tabDefs = [
  { label: "All", kind: undefined },
  { label: "Purchases", kind: "purchase" },
  { label: "Sales", kind: "sale" },
] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind: rawKind } = await searchParams;
  const kind = rawKind === "sale" || rawKind === "purchase" ? rawKind : undefined;

  const all = listInvoices(await dbForRequest());
  const invoices = kind ? all.filter((i) => i.direction === kind) : all;

  const owedToYou = all
    .filter((i) => i.direction === "sale" && i.status === "posted" && !i.paid)
    .reduce((s, i) => s + i.total, 0);
  const youOwe = all
    .filter((i) => i.direction === "purchase" && i.status === "posted" && !i.paid)
    .reduce((s, i) => s + i.total, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        subtitle="Purchase and sales invoices"
        action={<NewInvoiceButton />}
      />

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-line">
        {tabDefs.map(({ label, kind: k }) => {
          const href = k ? `/invoices?kind=${k}` : "/invoices";
          const active = kind === k;
          return (
            <Link
              key={label}
              href={href}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                active
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm text-slate-500">No invoices yet.</p>
      ) : (
        <DataTable
          head={
            <>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Party</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Paid</th>
              <th className="px-3 py-2 text-right">Total</th>
            </>
          }
        >
          {invoices.map((i) => (
            <tr key={i.id} className="border-t border-line">
              <td className="px-3 py-2">
                {i.direction === "sale" ? (
                  <Badge variant="emerald">↗ Sale</Badge>
                ) : (
                  <Badge variant="amber">↘ Purchase</Badge>
                )}
              </td>
              <td className="px-3 py-2">
                <Link
                  href={`/invoices/${i.id}`}
                  className="font-medium text-emerald-700 hover:underline"
                >
                  {i.number}
                </Link>
              </td>
              <td className="px-3 py-2">{i.customer ?? i.supplier ?? "—"}</td>
              <td className="px-3 py-2">{i.invoiceDate ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge variant={i.status === "posted" ? "emerald" : "amber"}>
                  {i.status}
                </Badge>
              </td>
              <td className="px-3 py-2">
                {i.status === "posted" ? (
                  <Badge variant={i.paid ? "emerald" : "red"}>
                    {i.paid ? "Paid" : "Unpaid"}
                  </Badge>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <Money cents={i.total} />
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {/* Running totals */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="rounded-xl border border-line bg-white px-4 py-3 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-slate-500">Owed to you</p>
          <p className="mt-1 text-base font-semibold text-emerald-700">
            <Money cents={owedToYou} />
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-3 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-slate-500">You owe</p>
          <p className="mt-1 text-base font-semibold text-amber-700">
            <Money cents={youOwe} />
          </p>
        </div>
      </div>
    </div>
  );
}
