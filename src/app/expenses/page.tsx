import { Suspense } from "react";
import { dbForRequest } from "@/lib/auth/request";
import { listExpenses, totalExpensesCents, expensesByCategory, amountsOwedByPerson } from "@/lib/db/expenses";
import { rangeFromParams, currentIsoWeek, periodLabel } from "@/lib/ui/expense-range";
import { ExpensesTable } from "@/components/expenses/ExpensesTable";
import { PeriodFilter } from "@/components/expenses/PeriodFilter";
import { AddExpenseButton } from "@/components/expenses/AddExpenseButton";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  // Default to the current week when no period param is present.
  const hasPeriod = sp.week || sp.month || sp.all || sp.from || sp.to;
  const effective = hasPeriod ? sp : { ...sp, week: currentIsoWeek() };
  const range = rangeFromParams(effective);

  const db = await dbForRequest();
  const expenses = listExpenses(db, range);
  const byCat = expensesByCategory(db, range);
  const owed = amountsOwedByPerson(db); // all-time, ignores the period filter

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle="Business costs"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Suspense fallback={null}><PeriodFilter /></Suspense>
            <AddExpenseButton />
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={`Total (${periodLabel(effective)})`} value={<Money cents={totalExpensesCents(db, range)} />} />
        <Card title="By category">
          {byCat.length === 0 ? <p className="text-sm text-slate-400">No expenses in range.</p> : (
            <ul className="space-y-1 text-sm">
              {byCat.map((c) => (
                <li key={c.category ?? "_uncategorized"} className="flex justify-between gap-6">
                  <span>{c.category}</span><span className="font-medium"><Money cents={c.totalCents} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Who's owed (all-time)">
          {owed.length === 0 ? <p className="text-sm text-slate-400">Nobody is owed.</p> : (
            <ul className="space-y-1 text-sm">
              {owed.map((o) => (
                <li key={o.person} className="flex justify-between gap-6">
                  <span>{o.person}</span><span className="font-medium"><Money cents={o.totalCents} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <ExpensesTable rows={expenses} />
    </div>
  );
}
