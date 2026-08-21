"use client";
import { useState } from "react";
import { Money } from "@/components/Money";
import { DataTable } from "@/components/ui/DataTable";
import { avgPerUnitCents } from "@/lib/calc/avg-per-unit";
import { sortProducts, type SortKey, type SortDir } from "@/lib/calc/sort-products";
import type { ReportProductLine } from "@/lib/calc/ledger-report";

type Col = { key: SortKey; label: string; align?: "right" };

const SHOW_COLS: Col[] = [
  { key: "productName", label: "Product" },
  { key: "qty", label: "Qty" },
  { key: "unitCostCents", label: "Unit cost" },
  { key: "costCents", label: "Cost" },
  { key: "revenueCents", label: "Revenue" },
  { key: "avgPerUnit", label: "Avg/unit" },
  { key: "profitCents", label: "Profit", align: "right" },
];
const REPORT_COLS: Col[] = [
  { key: "productName", label: "Product" },
  { key: "qty", label: "Qty" },
  { key: "unitCostCents", label: "Unit cost" },
  { key: "costCents", label: "Cost" },
  { key: "revenueCents", label: "Revenue" },
  { key: "profitCents", label: "Profit" },
];

export function ProductsTable({ products, variant }: { products: ReportProductLine[]; variant: "show" | "report" }) {
  const [key, setKey] = useState<SortKey | null>(null);
  const [dir, setDir] = useState<SortDir>("asc");
  const cols = variant === "show" ? SHOW_COLS : REPORT_COLS;
  const rows = key ? sortProducts(products, key, dir) : products;
  const caret = (k: SortKey) => (key === k ? (dir === "asc" ? " ▲" : " ▼") : "");
  function click(k: SortKey) {
    if (key === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setKey(k); setDir("asc"); }
  }

  const nameCell = (p: ReportProductLine) => (
    <>
      {p.productName}
      {!p.mapped && <span className="ml-1 text-amber-700">(unmapped)</span>}
      {variant === "show" && p.isBundle && (
        <span className="ml-1 text-blue-700">
          ▸ bundle ({p.components?.length ?? 0} item{(p.components?.length ?? 0) === 1 ? "" : "s"})
        </span>
      )}
      {variant === "show" && p.isBundle && p.components && (
        <div className="mt-0.5 text-[11px] text-slate-500">
          {p.components.map((c) => `${c.qty}× ${c.name}`).join(", ")}
        </div>
      )}
    </>
  );

  const showMobileCards = (
    <div className="space-y-3 sm:hidden">
      {rows.map((p, idx) => {
        const avg = avgPerUnitCents(p.revenueCents, p.qty);
        const statCols = variant === "show"
          ? [
              { label: "Qty", value: p.qty },
              { label: "Unit cost", value: p.unitCostCents == null ? "—" : <Money cents={p.unitCostCents} /> },
              { label: "Cost", value: <Money cents={p.costCents} /> },
              { label: "Revenue", value: <Money cents={p.revenueCents} /> },
              { label: "Avg/unit", value: avg == null ? "—" : <Money cents={avg} /> },
              { label: "Profit", value: <Money cents={p.profitCents} />, profit: true },
            ]
          : [
              { label: "Qty", value: p.qty },
              { label: "Unit cost", value: p.unitCostCents == null ? "—" : <Money cents={p.unitCostCents} /> },
              { label: "Cost", value: <Money cents={p.costCents} /> },
              { label: "Revenue", value: <Money cents={p.revenueCents} /> },
              { label: "Profit", value: <Money cents={p.profitCents} />, profit: true },
            ];
        return (
          <div key={`${p.productName}-${idx}`} className="rounded-xl border border-line bg-white p-3">
            <div className="text-sm font-semibold text-slate-900">{nameCell(p)}</div>
            <hr className="my-2 border-line" />
            <div className="grid grid-cols-3 gap-x-3 gap-y-2">
              {statCols.map(({ label, value, profit }) => (
                <div key={label}>
                  <div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div>
                  <div className={`text-xs font-medium ${profit ? (p.profitCents >= 0 ? "text-emerald-700" : "text-red-600") : "text-slate-800"}`}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (variant === "report") {
    return (
      <>
        {showMobileCards}
        <table className="hidden w-full text-left text-xs sm:table">
          <thead><tr className="border-b border-line text-slate-500">
            {cols.map((c) => (
              <th key={c.key} className="cursor-pointer select-none p-1" onClick={() => click(c.key)}>
                {c.label}{caret(c.key)}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((p, idx) => (
              <tr key={`${p.productName}-${idx}`} className="border-b border-line">
                <td className="p-1">{nameCell(p)}</td>
                <td className="p-1">{p.qty}</td>
                <td className="p-1">{p.unitCostCents == null ? "—" : <Money cents={p.unitCostCents} />}</td>
                <td className="p-1"><Money cents={p.costCents} /></td>
                <td className="p-1"><Money cents={p.revenueCents} /></td>
                <td className="p-1"><Money cents={p.profitCents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <>
      {showMobileCards}
      <div className="hidden sm:block">
        <DataTable head={cols.map((c) => (
          <th key={c.key} className={`cursor-pointer select-none px-3 py-2${c.align === "right" ? " text-right" : ""}`} onClick={() => click(c.key)}>
            {c.label}{caret(c.key)}
          </th>
        ))}>
          {rows.map((p, idx) => (
            <tr key={`${p.productName}-${idx}`} className="border-t border-line">
              <td className="px-3 py-2">{nameCell(p)}</td>
              <td className="px-3 py-2">{p.qty}</td>
              <td className="px-3 py-2">{p.unitCostCents == null ? "—" : <Money cents={p.unitCostCents} />}</td>
              <td className="px-3 py-2"><Money cents={p.costCents} /></td>
              <td className="px-3 py-2"><Money cents={p.revenueCents} /></td>
              <td className="px-3 py-2">{(() => { const a = avgPerUnitCents(p.revenueCents, p.qty); return a == null ? "—" : <Money cents={a} />; })()}</td>
              <td className="px-3 py-2 text-right"><Money cents={p.profitCents} /></td>
            </tr>
          ))}
        </DataTable>
      </div>
    </>
  );
}
