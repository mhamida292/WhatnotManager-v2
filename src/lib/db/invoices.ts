import type { DB } from "./connection";
import { insertItem, qtyRemaining, listItems, reconcileWhatnotOnly } from "./inventory";
import { addPurchase, recomputeItemTotals } from "./purchases";
import { settleWhatnotOnly } from "./moves";
import { resolveItemId, recordSupplierIdentifier } from "./aliases";
import { bestMatch, MATCH_THRESHOLD } from "@/lib/calc/name-match";

export interface Invoice {
  id: number; number: string; direction: "purchase" | "sale";
  supplier: string | null; customer: string | null; invoiceDate: string | null;
  notes: string | null; status: "draft" | "posted"; postedAt: string | null;
  paid: boolean; paidOn: string | null; total: number;
}
export interface InvoiceLine {
  id: number; invoiceId: number; itemId: number | null; productName: string;
  quantity: number; unitCostCents: number; unitPriceCents: number | null;
  displayName: string; kind: "item" | "charge";
}

/** Explicit per-line resolution supplied when posting a purchase invoice:
 *  either link the line to an existing item, or create a new item with the
 *  given name and link to that. */
export type PostResolution =
  | { lineId: number; itemId: number }
  | { lineId: number; createName: string };

/** Display number derived from the row id, e.g. 7 -> "INV-0007". */
export function invoiceNumber(id: number): string {
  return `INV-${String(id).padStart(4, "0")}`;
}

const SELECT = `
  SELECT i.id, i.direction, i.supplier, i.customer, i.invoice_date AS invoiceDate, i.notes,
    i.status, i.posted_at AS postedAt, i.paid, i.paid_on AS paidOn,
    COALESCE((SELECT SUM(quantity * CASE WHEN i.direction='sale' THEN COALESCE(unit_price_cents,0) ELSE unit_cost_cents END)
              FROM invoice_lines WHERE invoice_id = i.id), 0) AS total
  FROM invoices i`;

function hydrate(row: any): Invoice {
  return { ...row, number: invoiceNumber(row.id), paid: !!row.paid, total: Number(row.total) };
}

export function createInvoice(db: DB, p: { direction?: "purchase" | "sale"; supplier?: string | null; customer?: string | null; invoiceDate: string | null; notes: string | null }): number {
  const info = db.prepare("INSERT INTO invoices (direction, supplier, customer, invoice_date, notes) VALUES (?,?,?,?,?)")
    .run(p.direction ?? "purchase", p.supplier ?? null, p.customer ?? null, p.invoiceDate, p.notes);
  return Number(info.lastInsertRowid);
}

export function updateInvoice(db: DB, id: number, p: { supplier: string | null; customer?: string | null; invoiceDate: string | null; notes: string | null }): void {
  db.prepare("UPDATE invoices SET supplier = ?, customer = ?, invoice_date = ?, notes = ? WHERE id = ? AND status = 'draft'")
    .run(p.supplier, p.customer ?? null, p.invoiceDate, p.notes, id);
}

export function setInvoicePaid(db: DB, id: number, paid: boolean, paidOn: string | null): void {
  db.prepare("UPDATE invoices SET paid = ?, paid_on = ? WHERE id = ?").run(paid ? 1 : 0, paid ? paidOn : null, id);
}

export function getInvoice(db: DB, id: number): Invoice | null {
  const row = db.prepare(`${SELECT} WHERE i.id = ?`).get(id);
  return row ? hydrate(row) : null;
}

export function listInvoices(db: DB): Invoice[] {
  return (db.prepare(`${SELECT} ORDER BY i.id DESC`).all() as any[]).map(hydrate);
}

/** Throws if the invoice is not an editable draft. */
function assertDraft(db: DB, invoiceId: number): void {
  const r = db.prepare("SELECT status FROM invoices WHERE id = ?").get(invoiceId) as { status: string } | undefined;
  if (!r || r.status !== "draft") throw new Error("Invoice is not an editable draft");
}

export function listInvoiceLines(db: DB, invoiceId: number): InvoiceLine[] {
  return db.prepare(
    `SELECT il.id, il.invoice_id AS invoiceId, il.item_id AS itemId,
       il.product_name AS productName,
       COALESCE(ii.name, il.product_name) AS displayName,
       il.quantity, il.unit_cost_cents AS unitCostCents, il.unit_price_cents AS unitPriceCents, il.kind
     FROM invoice_lines il
     LEFT JOIN inventory_items ii ON ii.id = il.item_id
     WHERE il.invoice_id = ? ORDER BY il.id`
  ).all(invoiceId) as InvoiceLine[];
}

/** Add a non-inventory charge/deduction line. amountCents may be negative
 *  (a deduction). quantity is 1; item_id is null; kind is 'charge'. */
export function addInvoiceCharge(db: DB, p: { invoiceId: number; name: string; amountCents: number }): number {
  assertDraft(db, p.invoiceId);
  const amt = Math.trunc(p.amountCents);
  const info = db.prepare(
    `INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents, unit_price_cents, kind)
     VALUES (?, NULL, ?, 1, ?, ?, 'charge')`
  ).run(p.invoiceId, p.name.trim(), amt, amt);
  return Number(info.lastInsertRowid);
}

export function addInvoiceLine(db: DB, p: { invoiceId: number; itemId: number | null; productName: string; quantity: number; unitCostCents: number; unitPriceCents?: number | null }): number {
  assertDraft(db, p.invoiceId);
  const info = db.prepare(
    "INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents, unit_price_cents) VALUES (?,?,?,?,?,?)"
  ).run(p.invoiceId, p.itemId, p.productName, p.quantity, p.unitCostCents, p.unitPriceCents ?? null);
  return Number(info.lastInsertRowid);
}

export function updateInvoiceLine(db: DB, id: number, p: { itemId: number | null; productName: string; quantity: number; unitCostCents: number; unitPriceCents?: number | null }): void {
  const row = db.prepare("SELECT invoice_id AS invoiceId FROM invoice_lines WHERE id = ?").get(id) as { invoiceId: number } | undefined;
  if (!row) return;
  assertDraft(db, row.invoiceId);
  db.prepare("UPDATE invoice_lines SET item_id = ?, product_name = ?, quantity = ?, unit_cost_cents = ?, unit_price_cents = ? WHERE id = ?")
    .run(p.itemId, p.productName, p.quantity, p.unitCostCents, p.unitPriceCents ?? null, id);
}

export function deleteInvoiceLine(db: DB, id: number): void {
  const row = db.prepare("SELECT invoice_id AS invoiceId FROM invoice_lines WHERE id = ?").get(id) as { invoiceId: number } | undefined;
  if (!row) return;
  assertDraft(db, row.invoiceId);
  db.prepare("DELETE FROM invoice_lines WHERE id = ?").run(id);
}

/** Post a draft: for purchases, each line becomes a purchase batch (creating/linking
 *  products) and recomputes item totals. For sales, validates all lines have items and
 *  checks stock before flipping status (stock drops automatically via qtySoldWholesale).
 *  Atomic. */
export function postInvoice(db: DB, id: number, resolutions: PostResolution[] = []): void {
  const tx = db.transaction(() => {
    const inv = db.prepare("SELECT status, direction, invoice_date AS invoiceDate FROM invoices WHERE id = ?").get(id) as { status: string; direction: string; invoiceDate: string | null } | undefined;
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "draft") throw new Error("Invoice is already posted");
    const lines = listInvoiceLines(db, id);
    if (lines.length === 0) throw new Error("Cannot post an empty invoice");

    if (inv.direction === "sale") {
      // Validate items BEFORE flipping status (qtySoldWholesale counts posted lines).
      for (const line of lines) {
        if (line.kind === "charge") continue;
        if (line.itemId == null) throw new Error(`Line "${line.productName}" must map to an item before posting a sale`);
      }
      // Aggregate requested quantity per itemId across ALL lines so that two lines
      // of the same item are checked as a unit (prevents multi-line oversell).
      const qtyByItem = new Map<number, number>();
      for (const line of lines) {
        if (line.kind === "charge") continue;
        qtyByItem.set(line.itemId!, (qtyByItem.get(line.itemId!) ?? 0) + line.quantity);
      }
      for (const [itemId, totalQty] of qtyByItem) {
        const remaining = qtyRemaining(db, itemId);
        if (totalQty > remaining) {
          const nm = db.prepare("SELECT name FROM inventory_items WHERE id = ?").get(itemId) as { name: string };
          throw new Error(`Can't sell ${totalQty} — only ${remaining} of "${nm.name}" remain`);
        }
      }
      for (const [itemId, totalQty] of qtyByItem) {
        settleWhatnotOnly(db, itemId, totalQty, "to_warehouse");
      }
      db.prepare("UPDATE invoices SET status = 'posted', posted_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      return; // sales create NO purchase batches; stock drops via qtySoldWholesale
    }

    // purchase path: resolve each unlinked line explicitly (no silent auto-create),
    // remember supplier names, then create batches.
    const resByLine = new Map(resolutions.map((r) => [r.lineId, r]));
    for (const line of lines) {
      if (line.kind === "charge") continue;
      let itemId = line.itemId;
      if (itemId == null) {
        const r = resByLine.get(line.id);
        if (r && "itemId" in r) {
          itemId = r.itemId;
        } else if (r && "createName" in r) {
          itemId = insertItem(db, { name: r.createName, unitCostCents: line.unitCostCents, qtyPurchased: 0, lotId: null });
        } else {
          const resolved = resolveItemId(db, line.productName);
          if (resolved == null) throw new Error(`Line "${line.productName}" needs an item`);
          itemId = resolved;
        }
        db.prepare("UPDATE invoice_lines SET item_id = ? WHERE id = ?").run(itemId, line.id);
      }
      // Remember the supplier's name for this item (collision-safe, no-op if taken).
      recordSupplierIdentifier(db, line.productName, itemId);
      addPurchase(db, { itemId, purchasedOn: inv.invoiceDate, quantity: line.quantity, unitCostCents: line.unitCostCents, invoiceId: id });
    }
    db.prepare("UPDATE invoices SET status = 'posted', posted_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  });
  tx();
}

/** Reverse a posted invoice: for purchases, removes batches and recomputes item totals.
 *  For sales, just reverts status to draft (stock returns automatically via
 *  qtySoldWholesale no longer counting this invoice). Lines are kept. Atomic. */
export function unpostInvoice(db: DB, id: number): void {
  const tx = db.transaction(() => {
    const inv = db.prepare("SELECT direction FROM invoices WHERE id = ?").get(id) as { direction: string } | undefined;
    if (inv?.direction === "sale") {
      const saleItemIds = (db.prepare("SELECT DISTINCT item_id AS id FROM invoice_lines WHERE invoice_id = ? AND item_id IS NOT NULL").all(id) as { id: number }[]).map((r) => r.id);
      db.prepare("UPDATE invoices SET status = 'draft', posted_at = NULL WHERE id = ?").run(id);
      for (const itemId of saleItemIds) reconcileWhatnotOnly(db, itemId);
      return;
    }
    // purchase path (unchanged)
    const itemIds = (db.prepare("SELECT DISTINCT item_id AS id FROM item_purchases WHERE invoice_id = ?").all(id) as { id: number }[]).map((r) => r.id);
    db.prepare("DELETE FROM item_purchases WHERE invoice_id = ?").run(id);
    for (const itemId of itemIds) recomputeItemTotals(db, itemId);
    db.prepare("UPDATE invoices SET status = 'draft', posted_at = NULL WHERE id = ?").run(id);
    for (const itemId of itemIds) reconcileWhatnotOnly(db, itemId);
  });
  tx();
}

export interface LineReview {
  lineId: number; productName: string;
  suggestedItemId: number | null; suggestedItemName: string | null;
  score: number; confident: boolean;
}
export interface PostPreview {
  autoResolved: { lineId: number; itemId: number }[];
  needsReview: LineReview[];
}

/** Purchase-only. Lines already linked to an item are ignored (nothing to decide).
 *  An unlinked line whose name resolves via an identifier is auto-resolved;
 *  otherwise it needs review with a best-match suggestion. */
export function previewPurchasePost(db: DB, invoiceId: number): PostPreview {
  const inv = db.prepare("SELECT direction FROM invoices WHERE id = ?").get(invoiceId) as { direction: string } | undefined;
  if (!inv || inv.direction !== "purchase") return { autoResolved: [], needsReview: [] };
  const items = listItems(db).map((i) => ({ id: i.id, name: i.name }));
  const byId = new Map(items.map((i) => [i.id, i.name]));
  const lines = listInvoiceLines(db, invoiceId);
  const autoResolved: { lineId: number; itemId: number }[] = [];
  const needsReview: LineReview[] = [];
  for (const line of lines) {
    if (line.kind === "charge") continue;
    if (line.itemId != null) continue; // already linked
    const resolved = resolveItemId(db, line.productName);
    if (resolved != null) {
      autoResolved.push({ lineId: line.id, itemId: resolved });
      continue;
    }
    const m = bestMatch(line.productName, items);
    needsReview.push({
      lineId: line.id,
      productName: line.productName,
      suggestedItemId: m ? m.itemId : null,
      suggestedItemName: m ? byId.get(m.itemId) ?? null : null,
      score: m ? m.score : 0,
      confident: m ? m.score >= MATCH_THRESHOLD : false,
    });
  }
  return { autoResolved, needsReview };
}

/** Delete an invoice (and its lines and any batches it created), recomputing
 *  affected items. Atomic. The batches are deleted explicitly (not via cascade)
 *  because a DB migrated from before invoice_id existed has the FK without
 *  ON DELETE CASCADE — see migrate() in connection.ts. Keep it explicit. */
export function deleteInvoice(db: DB, id: number): void {
  const tx = db.transaction(() => {
    const purchaseItemIds = (db.prepare("SELECT DISTINCT item_id AS id FROM item_purchases WHERE invoice_id = ?").all(id) as { id: number }[]).map((r) => r.id);
    const lineItemIds = (db.prepare("SELECT DISTINCT item_id AS id FROM invoice_lines WHERE invoice_id = ? AND item_id IS NOT NULL").all(id) as { id: number }[]).map((r) => r.id);
    const affectedItemIds = Array.from(new Set([...purchaseItemIds, ...lineItemIds]));
    db.prepare("DELETE FROM item_purchases WHERE invoice_id = ?").run(id);
    db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(id);
    db.prepare("DELETE FROM invoices WHERE id = ?").run(id);
    for (const itemId of purchaseItemIds) recomputeItemTotals(db, itemId);
    for (const itemId of affectedItemIds) reconcileWhatnotOnly(db, itemId);
  });
  tx();
}
