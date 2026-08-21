"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

const today = () => new Date().toISOString().slice(0, 10);

/** Creates a blank draft invoice and navigates to its editor. */
export function NewInvoiceButton() {
  const router = useRouter();

  async function createSale() {
    const res = await fetch("/api/invoices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "sale", invoiceDate: today() }),
    });
    if (!res.ok) return;
    const { id } = await res.json();
    router.push(`/invoices/${id}`);
  }

  async function createPurchase() {
    const res = await fetch("/api/invoices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: "purchase", invoiceDate: today() }),
    });
    if (!res.ok) return;
    const { id } = await res.json();
    router.push(`/invoices/${id}`);
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <Button onClick={createSale}>+ New sales invoice</Button>
      <Button variant="secondary" onClick={createPurchase}>+ New purchase</Button>
    </div>
  );
}
