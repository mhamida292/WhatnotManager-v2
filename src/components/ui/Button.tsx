import { ReactNode, ButtonHTMLAttributes } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary" | "danger";
const styles: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-line bg-white text-slate-700 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
};
const base =
  "inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50";

export function Button(
  { variant = "primary", href, className = "", children, ...rest }:
  { variant?: Variant; href?: string; className?: string; children: ReactNode } &
  ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const cls = `${base} ${styles[variant]} ${className}`;
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button className={cls} {...rest}>{children}</button>;
}
