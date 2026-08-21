import { dbForRequest } from "@/lib/auth/request";
import { getSettings } from "@/lib/db/settings";
import { SettingsForm } from "@/components/SettingsForm";
import GiveawayItemsManager from "@/components/GiveawayItemsManager";
import { BackupRestore } from "@/components/BackupRestore";
import { DangerZone } from "@/components/DangerZone";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = await dbForRequest();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Business details, invoices, and giveaway cost" />
      <SettingsForm initial={getSettings(db)} />
      <GiveawayItemsManager />
      <BackupRestore />
      <DangerZone />
    </div>
  );
}
