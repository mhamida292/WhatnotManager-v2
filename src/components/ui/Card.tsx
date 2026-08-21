import { ReactNode } from "react";

export function Card({ title, children, className = "" }: {
  title?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-white shadow-soft ${className}`}>
      {title && (
        <div className="border-b border-line px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
