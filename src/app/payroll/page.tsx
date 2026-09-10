import { Suspense } from "react";
import { dbForRequest } from "@/lib/auth/request";
import { listPayroll, totalPayrollCents, owedPayrollCents, payrollByPerson } from "@/lib/db/payroll";
import { listPayrollRates } from "@/lib/db/payroll-rates";
import { rangeFromParams } from "@/lib/ui/expense-range";
import { PayrollForm } from "@/components/payroll/PayrollForm";
import { PayrollTable } from "@/components/payroll/PayrollTable";
import { PayrollRates } from "@/components/payroll/PayrollRates";
import { PayrollMonthFilter } from "@/components/payroll/PayrollMonthFilter";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const range = rangeFromParams(sp);
  const db = await dbForRequest();
  const rows = listPayroll(db, range);
  const byPerson = payrollByPerson(db, range);
  const rates = listPayrollRates(db);
  // Everyone in payroll history, not just this range, so the rates card does not
  // lose a worker the moment you filter to a month they did not work.
  const people = payrollByPerson(db).map((p) => p.person);
  return (
    <div className="space-y-6">
      <PageHeader title="Payroll" subtitle="Work logged, charged to that day's shows" action={<Suspense fallback={null}><PayrollMonthFilter /></Suspense>} />
      <div className="grid gap-4 sm:grid-cols-[auto,auto,1fr] sm:items-start">
        <Stat label={range ? "Total (selected period)" : "Total payroll"} value={<Money cents={totalPayrollCents(db, range)} />} />
        <Stat label="Still owed" value={<Money cents={owedPayrollCents(db, range)} />} sub="Logged, not yet marked paid" />
        <Card title="By person">
          {byPerson.length === 0 ? <p className="text-sm text-slate-400">No payroll in range.</p> : (
            <ul className="space-y-1 text-sm">
              {byPerson.map((p) => (
                <li key={p.person} className="flex justify-between gap-6">
                  <span>{p.person}</span>
                  <span className="flex gap-4">
                    <span className="font-medium"><Money cents={p.totalCents} /></span>
                    <span className={p.owedCents > 0 ? "text-amber-600" : "text-slate-400"}>
                      {p.owedCents > 0 ? <><Money cents={p.owedCents} /> owed</> : "paid up"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <PayrollTable rows={rows} />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <PayrollForm rates={rates} />
        <PayrollRates rates={rates} people={people} />
      </div>
    </div>
  );
}
