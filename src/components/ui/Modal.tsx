"use client";
import { ReactNode } from "react";

/** Centered overlay dialog. Click the backdrop or the ✕ to close.
 *  `maxWidth` is a Tailwind max-w-* class; defaults to a comfortable medium width. */
export function Modal({ title, onClose, children, maxWidth = "max-w-lg" }: { title: string; onClose: () => void; children: ReactNode; maxWidth?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className={`mt-12 w-full ${maxWidth} rounded-2xl bg-white p-5 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
