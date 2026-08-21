import { dbForRequest } from "@/lib/auth/request";
import { listItems, qtyRemaining } from "@/lib/db/inventory";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { CountSheet } from "@/components/inventory/CountSheet";

export const dynamic = "force-dynamic";

export default async function CountPage() {
  const db = await dbForRequest();
  const items = listItems(db).filter((i) => i.archivedAt == null).map((i) => ({ id: i.id, name: i.name, location: i.location, expected: qtyRemaining(db, i.id) }));
  return (
    <div className="space-y-6">
      <PageHeader title="Count merchandise" subtitle="Enter what you counted; blank rows are skipped"
        action={<Button variant="secondary" href="/inventory">← Inventory</Button>} />
      <CountSheet items={items} />
    </div>
  );
}
