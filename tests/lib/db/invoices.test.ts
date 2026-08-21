import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { invoiceNumber, createInvoice, getInvoice, listInvoices, updateInvoice, addInvoiceLine, updateInvoiceLine, deleteInvoiceLine, listInvoiceLines, postInvoice, unpostInvoice, deleteInvoice, setInvoicePaid } from "@/lib/db/invoices";
import { insertItem, listItems, qtyRemaining } from "@/lib/db/inventory";
import { listPurchases, addPurchase } from "@/lib/db/purchases";
import { setAlias } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("invoices schema", () => {
  it("has invoices and invoice_lines tables and item_purchases.invoice_id", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain("invoices");
    expect(tables).toContain("invoice_lines");
    const cols = (db.prepare("PRAGMA table_info(item_purchases)").all() as any[]).map((c) => c.name);
    expect(cols).toContain("invoice_id");
  });
});

describe("invoices repo", () => {
  it("invoiceNumber formats the id as INV-0007", () => {
    expect(invoiceNumber(7)).toBe("INV-0007");
    expect(invoiceNumber(1234)).toBe("INV-1234");
  });

  it("createInvoice makes a draft; getInvoice and listInvoices return it", () => {
    const id = createInvoice(db, { supplier: "Squishy Co", invoiceDate: "2026-06-15", notes: "order 99" });
    const inv = getInvoice(db, id)!;
    expect(inv).toMatchObject({ id, number: invoiceNumber(id), supplier: "Squishy Co", invoiceDate: "2026-06-15", status: "draft", total: 0 });
    expect(inv.postedAt).toBeNull();
    expect(listInvoices(db).map((i) => i.id)).toContain(id);
  });

  it("updateInvoice changes header fields", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    updateInvoice(db, id, { supplier: "AliExpress", invoiceDate: "2026-06-01", notes: "x" });
    expect(getInvoice(db, id)).toMatchObject({ supplier: "AliExpress", invoiceDate: "2026-06-01", notes: "x" });
  });
});

describe("invoice lines", () => {
  it("addInvoiceLine adds lines and updates the invoice total; listInvoiceLines returns them", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: "2026-06-15", notes: null });
    const item = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Jellyfish", quantity: 12, unitCostCents: 150 });
    addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "Pineapple", quantity: 11, unitCostCents: 150 });
    const lines = listInvoiceLines(db, id);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ productName: "Jellyfish", quantity: 12, unitCostCents: 150, itemId: item });
    expect(getInvoice(db, id)!.total).toBe(12 * 150 + 11 * 150);
  });

  it("updateInvoiceLine and deleteInvoiceLine modify lines", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "X", quantity: 5, unitCostCents: 100 });
    updateInvoiceLine(db, lineId, { itemId: null, productName: "X", quantity: 6, unitCostCents: 120 });
    expect(listInvoiceLines(db, id)[0]).toMatchObject({ quantity: 6, unitCostCents: 120 });
    deleteInvoiceLine(db, lineId);
    expect(listInvoiceLines(db, id)).toHaveLength(0);
  });
});

describe("postInvoice", () => {
  it("posts: creates batches, makes new products, recomputes totals, sets status", () => {
    const id = createInvoice(db, { supplier: "Co", invoiceDate: "2026-06-15", notes: null });
    const jelly = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: jelly, productName: "Jellyfish", quantity: 12, unitCostCents: 150 });
    const pineappleLine = addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "Pineapple", quantity: 11, unitCostCents: 200 });

    postInvoice(db, id, [{ lineId: pineappleLine, createName: "Pineapple" }]);

    expect(getInvoice(db, id)!.status).toBe("posted");
    expect(getInvoice(db, id)!.postedAt).not.toBeNull();
    expect(qtyRemaining(db, jelly)).toBe(12);
    const pineapple = listItems(db).find((i) => i.name === "Pineapple")!;
    expect(pineapple.qtyPurchased).toBe(11);
    expect(pineapple.unitCostCents).toBe(200);
    expect(listPurchases(db, jelly)[0].invoiceId).toBe(id);
  });

  it("an unlinked line whose name resolves via an existing identifier links to it (no duplicate)", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    setAlias(db, "cheese", cheese);              // an identifier now maps "cheese" -> the item
    addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "cheese", quantity: 4, unitCostCents: 250 });
    postInvoice(db, id);                          // NO resolution — must auto-resolve via the identifier
    expect(listItems(db).filter((i) => i.name.toLowerCase() === "cheese")).toHaveLength(1); // no duplicate created
    expect(qtyRemaining(db, cheese)).toBe(4);
  });

  it("posting an empty invoice throws", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    expect(() => postInvoice(db, id)).toThrow();
  });
});

describe("unpost and delete invoice", () => {
  it("unpostInvoice pulls the stock back, reverts totals, returns to draft, keeps lines", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: "2026-06-15", notes: null });
    const jelly = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: jelly, productName: "Jellyfish", quantity: 12, unitCostCents: 150 });
    postInvoice(db, id);
    expect(qtyRemaining(db, jelly)).toBe(12);

    unpostInvoice(db, id);
    expect(getInvoice(db, id)!.status).toBe("draft");
    expect(getInvoice(db, id)!.postedAt).toBeNull();
    expect(qtyRemaining(db, jelly)).toBe(0);
    expect(listInvoiceLines(db, id)).toHaveLength(1);
    expect(listPurchases(db, jelly)).toHaveLength(0);
  });

  it("deleteInvoice removes header + lines + batches and recomputes items", () => {
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    const jelly = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: jelly, productName: "Jellyfish", quantity: 8, unitCostCents: 150 });
    postInvoice(db, id);

    deleteInvoice(db, id);
    expect(getInvoice(db, id)).toBeNull();
    expect(listInvoiceLines(db, id)).toHaveLength(0);
    expect(qtyRemaining(db, jelly)).toBe(0);
    expect(listPurchases(db, jelly)).toHaveLength(0);
  });

  it("invoice operations leave manual (non-invoice) batches alone", () => {
    const jelly = insertItem(db, { name: "Jellyfish", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: jelly, purchasedOn: null, quantity: 5, unitCostCents: 100 });
    const id = createInvoice(db, { supplier: null, invoiceDate: null, notes: null });
    addInvoiceLine(db, { invoiceId: id, itemId: jelly, productName: "Jellyfish", quantity: 3, unitCostCents: 200 });
    postInvoice(db, id);
    deleteInvoice(db, id);
    expect(qtyRemaining(db, jelly)).toBe(5);
  });
});

describe("sale invoice post / unpost", () => {
  it("posting a sale reduces remaining and creates no purchase batch", () => {
    const item = insertItem(db, { name: "Pack", unitCostCents: 175, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: item, purchasedOn: null, quantity: 100, unitCostCents: 175 });
    const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: 24, unitCostCents: 0, unitPriceCents: 300 });
    postInvoice(db, id);
    expect(getInvoice(db, id)!.status).toBe("posted");
    expect(qtyRemaining(db, item)).toBe(76);
    expect(listPurchases(db, item)).toHaveLength(1); // unchanged: only the original purchase batch
  });

  it("posting a sale that oversells is blocked", () => {
    const item = insertItem(db, { name: "Pack", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: item, purchasedOn: null, quantity: 10, unitCostCents: 0 });
    const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: 30, unitCostCents: 0, unitPriceCents: 100 });
    expect(() => postInvoice(db, id)).toThrow(/only 10/i);
    expect(getInvoice(db, id)!.status).toBe("draft");
  });

  it("a sale line with no item is rejected at post", () => {
    const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: id, itemId: null, productName: "Mystery", quantity: 1, unitCostCents: 0, unitPriceCents: 100 });
    expect(() => postInvoice(db, id)).toThrow(/must map to an item/i);
  });

  it("unpost of a sale returns the stock", () => {
    const item = insertItem(db, { name: "Pack", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: item, purchasedOn: null, quantity: 50, unitCostCents: 0 });
    const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: 20, unitCostCents: 0, unitPriceCents: 100 });
    postInvoice(db, id);
    expect(qtyRemaining(db, item)).toBe(30);
    unpostInvoice(db, id);
    expect(getInvoice(db, id)!.status).toBe("draft");
    expect(qtyRemaining(db, item)).toBe(50);
  });
});

describe("multi-line same-item oversell guard", () => {
  it("two lines of the same item whose summed qty exceeds remaining is blocked", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: item, purchasedOn: null, quantity: 10, unitCostCents: 0 });
    const id = createInvoice(db, { direction: "sale", customer: "Alice", invoiceDate: "2026-06-27", notes: null });
    // Two lines for the same item: 6 + 6 = 12, but only 10 remain
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Widget", quantity: 6, unitCostCents: 0, unitPriceCents: 100 });
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Widget", quantity: 6, unitCostCents: 0, unitPriceCents: 100 });
    expect(() => postInvoice(db, id)).toThrow(/Can't sell 12 — only 10/i);
    expect(getInvoice(db, id)!.status).toBe("draft");
    expect(qtyRemaining(db, item)).toBe(10); // stock unchanged
  });

  it("two lines of the same item whose summed qty equals remaining post correctly", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: item, purchasedOn: null, quantity: 10, unitCostCents: 0 });
    const id = createInvoice(db, { direction: "sale", customer: "Alice", invoiceDate: "2026-06-27", notes: null });
    // Two lines for the same item: 4 + 6 = 10, exactly the remaining
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Widget", quantity: 4, unitCostCents: 0, unitPriceCents: 100 });
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Widget", quantity: 6, unitCostCents: 0, unitPriceCents: 100 });
    postInvoice(db, id);
    expect(getInvoice(db, id)!.status).toBe("posted");
    expect(qtyRemaining(db, item)).toBe(0); // stock reduced by the full sum (10)
  });
});

describe("direction / customer / paid extensions", () => {
  it("createInvoice supports a sale with a customer; total uses unit price", () => {
    const id = createInvoice(db, { direction: "sale", customer: "Joe's Card Shop", invoiceDate: "2026-06-27", notes: null });
    const item = insertItem(db, { name: "Pack", unitCostCents: 175, qtyPurchased: 0, lotId: null });
    addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: 24, unitCostCents: 0, unitPriceCents: 300 });
    const inv = getInvoice(db, id)!;
    expect(inv).toMatchObject({ direction: "sale", customer: "Joe's Card Shop", paid: false });
    expect(inv.total).toBe(24 * 300);
    expect(listInvoiceLines(db, id)[0].unitPriceCents).toBe(300);
  });

  it("setInvoicePaid toggles paid + paidOn", () => {
    const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    setInvoicePaid(db, id, true, "2026-06-28");
    expect(getInvoice(db, id)).toMatchObject({ paid: true, paidOn: "2026-06-28" });
    setInvoicePaid(db, id, false, null);
    expect(getInvoice(db, id)).toMatchObject({ paid: false, paidOn: null });
  });

  it("purchase invoices still default direction and total off unit cost", () => {
    const id = createInvoice(db, { supplier: "Co", invoiceDate: "2026-06-15", notes: null });
    expect(getInvoice(db, id)).toMatchObject({ direction: "purchase", paid: false });
  });
});
