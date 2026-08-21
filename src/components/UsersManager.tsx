// src/components/UsersManager.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = { id: number; username: string; is_admin: number; created_at: string };

export function UsersManager({ users, currentUserId }: { users: Row[]; currentUserId: number }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) { setUsername(""); setPassword(""); router.refresh(); }
    else setError((await res.json().catch(() => ({})))?.error ?? "Failed");
  }

  async function reset(id: number) {
    const pw = prompt("New password for this user:");
    if (!pw) return;
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    router.refresh();
  }

  async function remove(id: number, name: string) {
    if (prompt(`Type DELETE to remove "${name}"'s login. Their data stays on the server.`) !== "DELETE") return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <input className="rounded border border-line px-3 py-2" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="rounded border border-line px-3 py-2" placeholder="Temp password" type="text"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="rounded bg-brand-600 px-3 py-2 text-white">Add user</button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </form>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th className="py-2">User</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-line">
              <td className="py-2">{u.username}</td>
              <td>{u.is_admin ? "Admin" : "User"}</td>
              <td className="space-x-3 text-right">
                <button onClick={() => reset(u.id)} className="text-slate-500 hover:text-slate-900">Reset password</button>
                {u.id !== currentUserId &&
                  <button onClick={() => remove(u.id, u.username)} className="text-red-600 hover:text-red-800">Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
