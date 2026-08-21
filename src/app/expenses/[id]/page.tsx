import { notFound } from "next/navigation";
import { dbForRequest } from "@/lib/auth/request";
import { getExpense } from "@/lib/db/expenses";
import { listExpenseItems } from "@/lib/db/expense-items";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { ExpenseDetailEditor } from "@/components/expenses/ExpenseDetailEditor";

export const dynamic = "force-dynamic";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = await dbForRequest();
  const expense = getExpense(db, id);
  if (!expense) notFound();
  const items = listExpenseItems(db, id);
  return (
    <div className="space-y-6">
      <PageHeader title="Expense detail" action={<Button variant="secondary" href="/expenses">‹ Back</Button>} />
      <ExpenseDetailEditor expense={expense} initialItems={items} />
    </div>
  );
}
