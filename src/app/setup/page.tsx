import { redirect } from "next/navigation";
import { getUsersDb } from "@/lib/auth/users-db";
import { adminExists } from "@/lib/auth/users";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (adminExists(getUsersDb())) redirect("/login");
  return (
    <AuthForm
      title="Create your admin account"
      subtitle="First-time setup — this account manages users."
      action="/api/setup"
      submitLabel="Create admin"
    />
  );
}
