import { Suspense } from "react";
import { dbForRequest } from "@/lib/auth/request";
import { listPayroll, totalPayrollCents, payrollByPerson } from "@/lib/db/payroll";
import { rangeFromParams } from "@/lib/ui/expense-range";
import { PayrollForm } from "@/components/payroll/PayrollForm";
import { PayrollTable } from "@/components/payroll/PayrollTable";
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
  return (
    <div className="space-y-6">
      <PageHeader title="Payroll" subtitle="Shifts worked, charged to that day's shows" action={<Suspense fallback={null}><PayrollMonthFilter /></Suspense>} />
      <div className="grid gap-4 sm:grid-cols-[auto,1fr] sm:items-start">
        <Stat label={range ? "Total (selected period)" : "Total payroll"} value={<Money cents={totalPayrollCents(db, range)} />} />
        <Card title="By person">
          {byPerson.length === 0 ? <p className="text-sm text-slate-400">No payroll in range.</p> : (
            <ul className="space-y-1 text-sm">
              {byPerson.map((p) => (
                <li key={p.person} className="flex justify-between gap-6"><span>{p.person}</span><span className="font-medium"><Money cents={p.totalCents} /></span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <PayrollTable rows={rows} />
      <PayrollForm />
    </div>
  );
}
