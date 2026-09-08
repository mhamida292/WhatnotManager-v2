"use client";
import { useState } from "react";
import { Money } from "@/components/Money";
import type { DismissedName } from "@/lib/db/dismissed-names";

async function restore(productName: string) {
  await fetch("/api/aliases/dismiss", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productName }),
  });
  location.reload();
}

/** The undo for "Not a product". Collapsed by default — these are names the user
 *  already decided about, so they shouldn't compete with the ones still needing a
 *  decision. Each row names the revenue riding on it, because dismissing hides the
 *  prompt without giving those sales a cost. */
export function DismissedNames({ rows }: { rows: DismissedName[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
      >
        Dismissed names ({rows.length}) — {open ? "hide" : "show"}
      </button>

      {open && (
        <div className="mt-2 space-y-1 rounded-xl border border-line bg-white p-3">
          {rows.map((r) => (
            <div key={r.code} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 last:border-0">
              <div>
                <div className="font-medium">{r.code}</div>
                <div className="text-xs text-slate-500">
                  {r.saleCount > 0
                    ? <><Money cents={r.revenueCents} /> across {r.saleCount} sale(s), counted at $0 cost</>
                    : "no sales recorded"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => restore(r.code)}
                className="text-xs text-brand-700 underline-offset-2 hover:underline"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
