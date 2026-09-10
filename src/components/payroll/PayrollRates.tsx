"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { PAYROLL_BASES, basisLabel } from "@/lib/ui/payroll-basis";
import type { PayrollBasis } from "@/lib/db/payroll";
import type { PayrollRate } from "@/lib/db/payroll-rates";

/** `people` is everyone who appears in payroll history, so the card lists the
 *  workers you actually have without asking you to name them again. */
export function PayrollRates({ rates, people }: { rates: PayrollRate[]; people: string[] }) {
  const [adding, setAdding] = useState("");
  // Names added via the "Add a person" control before any real rate is typed.
  // A rateCents of 0 would be deleted by the API rather than stored, so a
  // freshly added name lives only here until a real rate gives it a row that
  // persists on reload.
  const [added, setAdded] = useState<string[]>([]);
  const named = Array.from(new Set([...people, ...rates.map((r) => r.person), ...added])).sort();

  const rateFor = (person: string, basis: PayrollBasis) =>
    rates.find((r) => r.person === person && r.basis === basis);

  async function save(person: string, basis: PayrollBasis, value: string) {
    const rateCents = value.trim() === "" ? null : Math.round(Number(value) * 100);
    if (rateCents != null && !Number.isFinite(rateCents)) return;
    const res = await fetch("/api/payroll/rates", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person, basis, rateCents }),
    });
    if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
  }

  function addPerson() {
    const name = adding.trim();
    if (!name || named.includes(name)) return;
    setAdded((prev) => [...prev, name]);
    setAdding("");
  }

  return (
    <Card title="Rates">
      {named.length === 0 ? (
        <p className="text-sm text-slate-400">Log some work first, then set each person&apos;s default rates here.</p>
      ) : (
        <table className="text-sm">
          <thead><tr className="text-left text-slate-500">
            <th className="py-1 pr-6">Person</th>
            {PAYROLL_BASES.map((b) => <th key={b} className="px-3 py-1 font-normal">{basisLabel(b)}</th>)}
          </tr></thead>
          <tbody>
            {named.map((person) => (
              <tr key={person} className="border-t border-line">
                <td className="py-2 pr-6">{person}</td>
                {PAYROLL_BASES.map((b) => (
                  <td key={b} className="px-3 py-2">
                    <input className={`w-24 ${INPUT_CLASS}`} placeholder="—"
                      aria-label={`${person} ${basisLabel(b)} rate`}
                      defaultValue={rateFor(person, b) ? (rateFor(person, b)!.rateCents / 100).toFixed(2) : ""}
                      onBlur={(e) => {
                        const trimmed = e.target.value.trim();
                        const nextCents = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
                        if (nextCents != null && !Number.isFinite(nextCents)) return;
                        const storedCents = rateFor(person, b)?.rateCents ?? null;
                        if (nextCents !== storedCents) save(person, b, e.target.value);
                      }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex gap-2 text-sm">
        <input className={INPUT_CLASS} placeholder="Add a person" value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } }} />
        <button className="text-brand-600 hover:underline" onClick={addPerson}>Add</button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        These only pre-fill the form. Any entry can be saved at a different rate, and changing a
        rate here never alters work already logged.
      </p>
    </Card>
  );
}
