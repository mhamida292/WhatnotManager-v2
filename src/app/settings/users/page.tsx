// src/app/settings/users/page.tsx
import { requireAdmin } from "@/lib/auth/request";
import { getUsersDb } from "@/lib/auth/users-db";
import { listUsers } from "@/lib/auth/users";
import { UsersManager } from "@/components/UsersManager";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const admin = await requireAdmin();
  const users = listUsers(getUsersDb());
  return (
    <div className="space-y-6">
      <PageHeader title="Users" subtitle="Add or remove people who can log in" />
      <UsersManager users={users} currentUserId={admin.id} />
    </div>
  );
}
