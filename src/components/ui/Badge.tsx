import { ReactNode } from "react";

export type BadgeVariant = "red" | "amber" | "emerald" | "slate";
const variants: Record<BadgeVariant, string> = {
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-brand-100 text-brand-700",
  slate: "bg-slate-100 text-slate-600",
};

export function Badge({ variant = "slate", children }: {
  variant?: BadgeVariant; children: ReactNode;
}) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
}
