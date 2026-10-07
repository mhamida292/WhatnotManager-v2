import { dbForRequest } from "@/lib/auth/request";
import { listWhatnotMappings } from "@/lib/db/aliases";
import { whatnotAliasesByItem } from "@/lib/db/inventory";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { MappingsTable } from "@/components/inventory/MappingsTable";

export const dynamic = "force-dynamic";

export default async function MappingsPage() {
  const db = await dbForRequest();
  const rows = listWhatnotMappings(db);
  // The name the count sheet shows for items that go by more than one.
  const countNames = [...whatnotAliasesByItem(db).values()].filter((names) => names.length > 1).map((names) => names[0]);
  return (
    <div className="space-y-6">
      <PageHeader title="Whatnot mappings" subtitle={`${rows.length} Whatnot names and the items they count toward · change them on each item's page`}
        action={<Button variant="secondary" href="/inventory">← Inventory</Button>} />
      <MappingsTable rows={rows} countNames={countNames} />
    </div>
  );
}
