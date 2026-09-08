"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const baseLinks: [string, string][] = [
  ["/", "Dashboard"], ["/shows", "Shows"], ["/inventory", "Inventory"],
  ["/invoices", "Invoices"], ["/expenses", "Expenses"], ["/payroll", "Payroll"],
  ["/report", "Report"], ["/settings", "Settings"],
];

export function Nav({ user }: { user: { username: string; is_admin: number } | null }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user || path === "/login" || path === "/setup") return null;
  const links = user.is_admin ? [...baseLinks, ["/settings/users", "Users"] as [string, string]] : baseLinks;
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login"); router.refresh();
  }

  return (
    <nav className="relative border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 sm:px-6">
        <span className="shrink-0 py-4 text-sm font-bold tracking-tight text-brand-600">◆ Warehouse Manager</span>

        {/* Desktop links */}
        <div className="hidden flex-1 gap-5 overflow-x-auto sm:flex">
          {links.map(([href, label]) => {
            const on = isActive(href);
            return (
              <Link key={href} href={href}
                className={`shrink-0 whitespace-nowrap border-b-2 py-4 text-sm transition-colors ${
                  on ? "border-brand-600 font-semibold text-slate-900"
                     : "border-transparent text-slate-500 hover:text-slate-900"}`}>
                {label}
              </Link>
            );
          })}
        </div>

        {/* Desktop user */}
        <div className="ml-auto hidden shrink-0 items-center gap-3 text-sm text-slate-500 sm:flex">
          <span>{user.username}</span>
          <button onClick={logout} className="text-slate-500 hover:text-slate-900">Logout</button>
        </div>

        {/* Mobile: username + hamburger */}
        <div className="ml-auto flex items-center gap-3 sm:hidden">
          <span className="text-sm text-slate-500">{user.username}</span>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
            className="-mr-1 flex flex-col gap-[5px] p-2"
          >
            <span className="block h-0.5 w-5 rounded bg-slate-600" />
            <span className="block h-0.5 w-5 rounded bg-slate-600" />
            <span className="block h-0.5 w-5 rounded bg-slate-600" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 border-b border-line bg-white shadow-md sm:hidden">
          {links.map(([href, label]) => {
            const on = isActive(href);
            return (
              <Link key={href} href={href}
                onClick={() => setOpen(false)}
                className={`block border-b border-slate-50 px-6 py-3 text-sm ${
                  on ? "bg-slate-50 font-semibold text-slate-900"
                     : "text-slate-600 hover:bg-slate-50"}`}>
                {label}
              </Link>
            );
          })}
          <button
            onClick={() => { setOpen(false); logout(); }}
            className="block w-full px-6 py-3 text-left text-sm text-slate-600 hover:bg-slate-50"
          >
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}
