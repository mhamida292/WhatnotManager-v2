import Link from "next/link";
import { dbForRequest } from "@/lib/auth/request";
import { listShows } from "@/lib/db/shows";
import { getSettings } from "@/lib/db/settings";
import { ShowUpload } from "@/components/ShowUpload";
import { LedgerUpload } from "@/components/LedgerUpload";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";

export const dynamic = "force-dynamic";

export default async function ShowsPage() {
  const db = await dbForRequest();
  const shows = listShows(db);
  const settings = getSettings(db);
  return (
    <div className="space-y-6">
      <PageHeader title="Shows" subtitle="Import your Whatnot ledger and review each show" />
      <LedgerUpload />
      <ShowUpload defaultGiveawayUnitCents={settings.giveawayUnitCents} defaultShippingCents={settings.defaultShippingSuppliesCents} />
      <DataTable head={<>
        <th className="px-4 py-2">Date</th>
        <th className="px-4 py-2 text-right">Payout</th>
      </>}>
        {shows.length === 0 && (
          <tr><td colSpan={2} className="px-4 py-3 text-slate-500">
            No shows saved yet. Upload a CSV above, fill in the date and payout, then Save.
          </td></tr>
        )}
        {shows.map((s) => (
          <tr key={s.id} className="border-t border-line hover:bg-slate-50">
            <td className="px-4 py-2">
              <Link className="font-medium text-brand-700 hover:underline" href={`/shows/${s.id}`}>
                {s.showDate || `Show #${s.id} (no date)`}
              </Link>
            </td>
            <td className="px-4 py-2 text-right"><Money cents={s.payoutCents} /></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
