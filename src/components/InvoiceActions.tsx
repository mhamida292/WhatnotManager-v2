"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PostReviewModal, type LineReview } from "@/components/invoice/PostReviewModal";

/** Post / Unpost / Delete / Generate / Mark-paid buttons for an invoice. */
export function InvoiceActions({
  id, status, canPost, paid, items,
}: {
  id: number;
  status: "draft" | "posted";
  canPost: boolean;
  paid: boolean;
  items: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<LineReview[] | null>(null);

  async function call(url: string, method: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(url, { method });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
      router.refresh();
    } catch { setError("Failed"); setBusy(false); }
  }

  async function startPost() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/post-preview`);
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
      const pre = await res.json() as { needsReview: LineReview[] };
      if (pre.needsReview.length === 0) { await doPost([]); return; }
      setBusy(false);
      setReview(pre.needsReview);           // open modal
    } catch { setError("Failed"); setBusy(false); }
  }

  async function doPost(resolutions: unknown[]) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/post`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutions }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
      setReview(null);
      router.refresh();
    } catch { setError("Failed"); setBusy(false); }
  }

  async function togglePaid() {
    const newPaid = !paid;
    const today = new Date().toISOString().slice(0, 10);
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid: newPaid, paidOn: today }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
      router.refresh();
    } catch { setError("Failed"); setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" href={`/api/invoices/${id}/pdf`}>Download PDF</Button>
      {status === "draft" ? (
        <Button disabled={busy || !canPost} onClick={startPost}>Post</Button>
      ) : (
        <Button variant="secondary" disabled={busy} onClick={() => call(`/api/invoices/${id}/post`, "DELETE", "Unpost this invoice? Its stock will be removed from inventory.")}>Unpost</Button>
      )}
      {status === "posted" && (
        <Button variant="secondary" disabled={busy} onClick={togglePaid}>
          {paid ? "Mark unpaid" : "Mark paid"}
        </Button>
      )}
      <Button variant="danger" disabled={busy}
        onClick={async () => { if (!confirm("Delete this invoice? Any stock it added is removed.")) return; setBusy(true); const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" }); if (res.ok) router.push("/invoices"); else { setError("Failed"); setBusy(false); } }}>
        Delete
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
      {review && (
        <PostReviewModal
          reviews={review}
          items={items}
          onCancel={() => setReview(null)}
          onConfirm={(resolutions) => doPost(resolutions)}
        />
      )}
    </div>
  );
}
