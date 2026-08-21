import { redirect } from "next/navigation";
import { getUsersDb } from "@/lib/auth/users-db";
import { countUsers } from "@/lib/auth/users";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (countUsers(getUsersDb()) === 0) redirect("/setup");
  return <AuthForm title="Sign in" action="/api/auth/login" submitLabel="Sign in" />;
}
