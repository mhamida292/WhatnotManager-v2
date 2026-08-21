"use client";
import { useEffect, useRef, useState } from "react";
import { ItemCombobox } from "@/components/ItemCombobox";
import { groupBundles, flattenBundles } from "@/lib/calc/bundle-grouping";

interface SaleLine { id: number; productName: string | null; amountCents: number; saleNumber: string | null; }
interface Item { id: number; name: string; unitCostCents: number; }
interface Component { cid: number; itemId: number | null; qty: number; }
interface Bundle { cid: number; lineIds: number[]; components: Component[]; }

const short = (saleNumber: string | null) => (saleNumber ? `#${saleNumber}` : "#—");
const lineLabel = (l: SaleLine) => `${short(l.saleNumber)} — ${l.productName ?? "Sale"} — $${(l.amountCents / 100).toFixed(2)}`;

/** Collapsed, searchable, name-sorted picker for the orders that make up a bundle. */
function OrdersPicker({
  saleLines, selectedIds, isDisabled, onToggle,
}: {
  saleLines: SaleLine[];
  selectedIds: number[];
  isDisabled: (id: number) => boolean;
  onToggle: (id: number, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = new Set(selectedIds);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const sorted = [...saleLines].sort((a, b) => {
    const n = (a.productName ?? "").localeCompare(b.productName ?? "");
    return n !== 0 ? n : (parseInt(a.saleNumber ?? "0", 10) || 0) - (parseInt(b.saleNumber ?? "0", 10) || 0);
  });
  const q = query.trim().toLowerCase();
  const visible = q ? sorted.filter((l) => lineLabel(l).toLowerCase().includes(q)) : sorted;
  const selectedLines = sorted.filter((l) => selected.has(l.id));

  return (
    <div className="mt-2" ref={ref}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Orders in this bundle</div>

      <button
        type="button" onClick={() => setOpen((o) => !o)}
        className="mt-1 flex w-full items-center justify-between rounded border border-line bg-white px-3 py-2 text-left text-sm hover:bg-slate-50"
      >
        <span className={selectedLines.length ? "text-slate-700" : "text-slate-400"}>
          {selectedLines.length ? `${selectedLines.length} order${selectedLines.length === 1 ? "" : "s"} selected` : "Select orders…"}
        </span>
        <span className="text-slate-400">{open ? "▴" : "▾"}</span>
      </button>

      {selectedLines.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectedLines.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              {lineLabel(l)}
              <button type="button" onClick={() => onToggle(l.id, false)} className="text-blue-400 hover:text-blue-700" aria-label="Remove order">×</button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-1 rounded border border-line bg-white p-2 shadow-sm">
          <input
            autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter orders… (e.g. 'on screen')"
            className="mb-2 w-full rounded border border-line px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="max-h-64 overflow-y-auto">
            {visible.length === 0
              ? <p className="px-1 py-2 text-sm text-slate-400">No matching orders.</p>
              : (
                <div className="grid gap-0.5 sm:grid-cols-2">
                  {visible.map((l) => {
                    const checked = selected.has(l.id);
                    const disabled = !checked && isDisabled(l.id);
                    return (
                      <label key={l.id} className={`flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50 ${disabled ? "text-slate-300" : "text-slate-700"}`}>
                        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(l.id, e.target.checked)} />
                        <span>{lineLabel(l)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BundleEditor({ showId }: { showId: number }) {
  const [saleLines, setSaleLines] = useState<SaleLine[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [saved, setSaved] = useState(false);
  const cidRef = useRef(0);
  const mint = () => cidRef.current++;

  useEffect(() => {
    fetch(`/api/shows/${showId}/bundles`).then((r) => r.json()).then((d) => {
      setSaleLines(d.saleLines);
      setItems(d.items);
      const groups = groupBundles(
        d.bundles.map((b: any) => ({ ledgerTxnId: b.ledgerTxnId, components: b.components }))
      );
      setBundles(groups.map((g) => ({
        cid: mint(), lineIds: g.lineIds,
        components: g.components.map((c) => ({ cid: mint(), itemId: c.itemId, qty: c.qty })),
      })));
    });
  }, [showId]);

  const unitOf = (id: number | null) => items.find((i) => i.id === id)?.unitCostCents ?? 0;
  const lineOf = (id: number) => saleLines.find((l) => l.id === id);
  // a line may belong to at most one bundle card
  const ownerOf = new Map<number, number>(); // lineId -> bundle index
  bundles.forEach((b, bi) => b.lineIds.forEach((id) => ownerOf.set(id, bi)));
  const dirty = () => setSaved(false);

  function updateBundle(bi: number, fn: (b: Bundle) => Bundle) {
    setBundles((prev) => prev.map((b, i) => (i === bi ? fn(b) : b))); dirty();
  }
  function addBundle() {
    setBundles((prev) => {
      const used = new Set(prev.flatMap((b) => b.lineIds));
      const free = saleLines.find((l) => !used.has(l.id));
      return [...prev, { cid: mint(), lineIds: free ? [free.id] : [], components: [] }];
    });
    dirty();
  }
  function removeBundle(bi: number) { setBundles((prev) => prev.filter((_, i) => i !== bi)); dirty(); }
  function toggleLine(bi: number, lineId: number, on: boolean) {
    updateBundle(bi, (b) => ({
      ...b,
      lineIds: on ? [...b.lineIds, lineId] : b.lineIds.filter((id) => id !== lineId),
    }));
  }
  function addComponent(bi: number) {
    if (items[0]) updateBundle(bi, (b) => ({ ...b, components: [...b.components, { cid: mint(), itemId: items[0].id, qty: 1 }] }));
  }
  function setComponent(bi: number, ci: number, patch: Partial<Component>) {
    updateBundle(bi, (b) => ({ ...b, components: b.components.map((c, i) => (i === ci ? { ...c, ...patch } : c)) }));
  }
  function removeComponent(bi: number, ci: number) {
    updateBundle(bi, (b) => ({ ...b, components: b.components.filter((_, i) => i !== ci) }));
  }
  const unitCostOf = (b: Bundle) => b.components.reduce((s, c) => s + c.qty * unitOf(c.itemId), 0);
  const revenueOf = (b: Bundle) => b.lineIds.reduce((s, id) => s + (lineOf(id)?.amountCents ?? 0), 0);

  async function save() {
    const groups = bundles
      .map((b) => ({ lineIds: b.lineIds, components: b.components.filter((c) => c.qty > 0 && c.itemId != null).map((c) => ({ itemId: c.itemId as number, qty: c.qty })) }))
      .filter((g) => g.lineIds.length > 0 && g.components.length > 0);
    const flat = flattenBundles(groups);
    await fetch(`/api/shows/${showId}/bundles`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundles: flat.map((f) => ({ ledgerTxnId: f.ledgerTxnId, components: f.components })) }),
    });
    setSaved(true);
  }

  if (saleLines.length === 0) {
    return <p className="text-sm text-slate-500">No sale lines on this show yet. Import the ledger first.</p>;
  }

  return (
    <section className="space-y-4">
      {bundles.map((b, bi) => {
        const lineCount = b.lineIds.length;
        const unitCost = unitCostOf(b);
        const cost = unitCost * lineCount;
        const revenue = revenueOf(b);
        return (
          <div key={b.cid} className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Bundle ({lineCount} order{lineCount === 1 ? "" : "s"})</span>
              <button onClick={() => removeBundle(bi)} className="text-sm text-red-600 hover:underline">Remove bundle</button>
            </div>

            <OrdersPicker
              saleLines={saleLines}
              selectedIds={b.lineIds}
              isDisabled={(id) => { const o = ownerOf.get(id); return o != null && o !== bi; }}
              onToggle={(id, on) => toggleLine(bi, id, on)}
            />

            {b.components.length > 0 && (
              <div className="mt-3">
                {/* Desktop header */}
                <div className="hidden sm:flex gap-4 border-b border-line pb-1 text-sm font-medium text-slate-500">
                  <span className="flex-1">Item</span>
                  <span className="w-20">Qty</span>
                  <span className="w-16">Cost</span>
                  <span className="w-14" />
                </div>
                <div className="space-y-3 pt-2 sm:space-y-0 sm:pt-0">
                  {b.components.map((c, ci) => (
                    <div key={c.cid} className="rounded-lg border border-line bg-white p-3 sm:rounded-none sm:border-0 sm:border-b sm:border-line sm:bg-transparent sm:p-0 sm:py-2 sm:flex sm:gap-4 sm:items-center last:sm:border-0">
                      {/* Item name — full width on mobile */}
                      <div className="mb-2 flex-1 sm:mb-0">
                        <div className="mb-1 text-xs text-slate-400 sm:hidden">Item</div>
                        <ItemCombobox items={items} value={c.itemId} onChange={(id) => setComponent(bi, ci, { itemId: id })} listId="bundle-item-names" placeholder="Search item…" />
                      </div>
                      {/* Qty + Cost + Remove in a row on mobile */}
                      <div className="flex items-end gap-3">
                        <div>
                          <div className="mb-1 text-xs text-slate-400 sm:hidden">Qty</div>
                          <input type="number" min={0} value={c.qty}
                            onChange={(e) => setComponent(bi, ci, { qty: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                            className="w-20 rounded border border-line bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </div>
                        <div>
                          <div className="mb-1 text-xs text-slate-400 sm:hidden">Cost</div>
                          <span className="block w-16 text-sm text-slate-600">${(c.qty * unitOf(c.itemId) / 100).toFixed(2)}</span>
                        </div>
                        <button onClick={() => removeComponent(bi, ci)} className="whitespace-nowrap text-sm text-red-600 hover:underline">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-4">
              <button onClick={() => addComponent(bi)} disabled={items.length === 0} className="text-sm font-medium text-blue-600 hover:underline disabled:opacity-50">+ Add component</button>
              <span className="text-sm text-slate-500">
                Cost ${(unitCost / 100).toFixed(2)} × {lineCount} = ${(cost / 100).toFixed(2)} · Revenue ${(revenue / 100).toFixed(2)} · Profit ${((revenue - cost) / 100).toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <button onClick={addBundle} className="text-sm font-medium text-blue-600 hover:underline">+ Add another bundle</button>
        <button onClick={save} className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save bundles</button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
      </div>
    </section>
  );
}
