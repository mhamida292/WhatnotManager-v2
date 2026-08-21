"use client";
import { Button } from "@/components/ui/Button";

export type BulkAction = { label: string; variant: "primary" | "danger"; onClick: () => void };

export function BulkActionBar({ count, actions, onClear, busy = false }: { count: number; actions: BulkAction[]; onClear: () => void; busy?: boolean }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
      <b>{count} selected</b>
      {actions.map((a) => (
        <Button key={a.label} variant={a.variant} onClick={a.onClick} disabled={busy} className="px-3 py-1.5 text-sm">{a.label}</Button>
      ))}
      <button onClick={onClear} className="ml-auto text-slate-500 hover:underline">Clear</button>
    </div>
  );
}
