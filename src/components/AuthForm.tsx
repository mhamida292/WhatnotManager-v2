"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ title, subtitle, action, submitLabel }: {
  title: string; subtitle?: string; action: string; submitLabel: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch(action, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) { router.push("/"); router.refresh(); return; }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Something went wrong");
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input className="w-full rounded border border-line px-3 py-2" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <input className="w-full rounded border border-line px-3 py-2" placeholder="Password" type="password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full rounded bg-brand-600 px-3 py-2 text-white disabled:opacity-50">
          {busy ? "…" : submitLabel}
        </button>
      </form>
    </div>
  );
}
