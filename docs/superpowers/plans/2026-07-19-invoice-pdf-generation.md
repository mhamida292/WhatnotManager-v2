# Invoice PDF Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a real downloadable PDF invoice (carbon-form style, US-Letter, black & white) that adapts to sale vs. purchase direction, with business contact fields (each skippable) added to Settings.

**Architecture:** A pure `invoicePdfModel(invoice, lines, settings)` helper builds the view-model (unit-tested). A `@react-pdf/renderer` `<Document>` renders it server-side (no headless Chrome) in a `GET /api/invoices/[id]/pdf` route that streams `application/pdf`. Settings gains three contact fields + three show-flags.

**Tech Stack:** TypeScript, Next.js 15, React 19, better-sqlite3, `@react-pdf/renderer`, Vitest 2.

## Global Constraints

- Money is integer cents (`_cents`/`Cents`). Line amount = qty × (sale: `unitPriceCents ?? 0`; purchase: `unitCostCents`).
- Schema changes additive + idempotent, guarded by `PRAGMA table_info(app_settings)` in `connection.ts` `migrate()`; fresh columns also added to `schema.ts`.
- Direction-adaptive: sale → heading "INVOICE", party "SOLD TO"=customer, "Unit price"; purchase → "PURCHASE INVOICE", party "SUPPLIER"=supplier, "Unit cost".
- Contact strip shows an item only when its text is non-empty AND its show-flag is true; omit the strip if none qualify.
- US-Letter, black ink, built-in fonts (Helvetica) — no external font files.
- Invoice number via existing `invoiceNumber(id)` (e.g. "INV-0007"), shown as "No. INV-0007".
- Tests in `tests/**/*.test.ts`; `npx vitest run <path>` for one file.
- The homelab runs the pruned Next **standalone** Docker image; the PDF dependency must be traced into that build (verify in Task 5).

---

### Task 1: Settings contact fields — schema + DB layer

**Files:**
- Modify: `src/lib/db/schema.ts` (app_settings columns)
- Modify: `src/lib/db/connection.ts` (idempotent migrations)
- Modify: `src/lib/db/settings.ts` (`Settings`, `getSettings`, `updateSettings`)
- Test: `tests/lib/db/settings.test.ts` (extend)

**Interfaces:**
- Produces: `Settings` gains `invoicePhone|invoiceAddress|invoiceEmail: string|null` and `invoiceShowPhone|invoiceShowAddress|invoiceShowEmail: boolean`.

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/db/settings.test.ts` (mirror its existing style; it uses `createDb(":memory:")`):

```ts
import { getSettings, updateSettings } from "@/lib/db/settings";
import { createDb } from "@/lib/db/connection";

describe("invoice contact settings", () => {
  it("defaults contact fields null and show-flags true", () => {
    const db = createDb(":memory:");
    const s = getSettings(db);
    expect(s.invoicePhone).toBeNull();
    expect(s.invoiceAddress).toBeNull();
    expect(s.invoiceEmail).toBeNull();
    expect(s.invoiceShowPhone).toBe(true);
    expect(s.invoiceShowAddress).toBe(true);
    expect(s.invoiceShowEmail).toBe(true);
  });
  it("round-trips contact fields and show-flags", () => {
    const db = createDb(":memory:");
    updateSettings(db, {
      ...getSettings(db),
      invoicePhone: "(313) 555-0142", invoiceAddress: "123 Warehouse Ave", invoiceEmail: "b@x.com",
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: false,
    });
    const s = getSettings(db);
    expect(s).toMatchObject({
      invoicePhone: "(313) 555-0142", invoiceAddress: "123 Warehouse Ave", invoiceEmail: "b@x.com",
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/lib/db/settings.test.ts`
Expected: FAIL — fields undefined.

- [ ] **Step 3: Fresh schema columns**

In `src/lib/db/schema.ts`, in the `app_settings` CREATE TABLE, add after `business_name TEXT`:

```sql
  business_name TEXT,
  invoice_phone TEXT,
  invoice_address TEXT,
  invoice_email TEXT,
  invoice_show_phone INTEGER NOT NULL DEFAULT 1,
  invoice_show_address INTEGER NOT NULL DEFAULT 1,
  invoice_show_email INTEGER NOT NULL DEFAULT 1
```

(Insert the new columns into the existing column list; keep the existing `INSERT OR IGNORE` seed row valid — the new columns take their DEFAULTs.)

- [ ] **Step 4: Idempotent migrations**

In `src/lib/db/connection.ts` `migrate()`, alongside the existing `app_settings` guard (`scols`), extend it:

```ts
  const scols = (db.prepare("PRAGMA table_info(app_settings)").all() as { name: string }[]).map((c) => c.name);
  if (!scols.includes("business_name")) db.exec("ALTER TABLE app_settings ADD COLUMN business_name TEXT");
  if (!scols.includes("invoice_phone")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_phone TEXT");
  if (!scols.includes("invoice_address")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_address TEXT");
  if (!scols.includes("invoice_email")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_email TEXT");
  if (!scols.includes("invoice_show_phone")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_show_phone INTEGER NOT NULL DEFAULT 1");
  if (!scols.includes("invoice_show_address")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_show_address INTEGER NOT NULL DEFAULT 1");
  if (!scols.includes("invoice_show_email")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_show_email INTEGER NOT NULL DEFAULT 1");
```

(Keep the existing `business_name` line if present; add the six new guarded lines. Reuse the existing `scols` variable — do not redeclare it.)

- [ ] **Step 5: Extend the DB layer**

In `src/lib/db/settings.ts`:

```ts
export interface Settings {
  ownerSharePct: number;
  giveawayUnitCents: number;
  defaultShippingSuppliesCents: number;
  businessName: string | null;
  invoicePhone: string | null;
  invoiceAddress: string | null;
  invoiceEmail: string | null;
  invoiceShowPhone: boolean;
  invoiceShowAddress: boolean;
  invoiceShowEmail: boolean;
}

export function getSettings(db: DB): Settings {
  const r = db.prepare(`SELECT owner_share_pct as ownerSharePct,
    giveaway_unit_cents as giveawayUnitCents,
    default_shipping_supplies_cents as defaultShippingSuppliesCents,
    business_name as businessName,
    invoice_phone as invoicePhone, invoice_address as invoiceAddress, invoice_email as invoiceEmail,
    invoice_show_phone as invoiceShowPhone, invoice_show_address as invoiceShowAddress, invoice_show_email as invoiceShowEmail
    FROM app_settings WHERE id = 1`).get() as (Omit<Settings, "invoiceShowPhone"|"invoiceShowAddress"|"invoiceShowEmail"> & { invoiceShowPhone: number; invoiceShowAddress: number; invoiceShowEmail: number }) | undefined;
  if (!r) throw new Error("app_settings row is missing");
  return { ...r, invoiceShowPhone: !!r.invoiceShowPhone, invoiceShowAddress: !!r.invoiceShowAddress, invoiceShowEmail: !!r.invoiceShowEmail };
}

export function updateSettings(db: DB, s: Settings): void {
  db.prepare(`UPDATE app_settings SET owner_share_pct = ?,
    giveaway_unit_cents = ?, default_shipping_supplies_cents = ?, business_name = ?,
    invoice_phone = ?, invoice_address = ?, invoice_email = ?,
    invoice_show_phone = ?, invoice_show_address = ?, invoice_show_email = ?
    WHERE id = 1`)
    .run(s.ownerSharePct, s.giveawayUnitCents, s.defaultShippingSuppliesCents, s.businessName,
      s.invoicePhone ?? null, s.invoiceAddress ?? null, s.invoiceEmail ?? null,
      s.invoiceShowPhone ? 1 : 0, s.invoiceShowAddress ? 1 : 0, s.invoiceShowEmail ? 1 : 0);
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/lib/db/settings.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. (If other call sites construct `Settings` literals, fix them — see Task 2's PUT route and `SettingsForm`; the settings PUT route currently rebuilds the object, so update it in Task 2.)

Note: the settings PUT route (`src/app/api/settings/route.ts`) calls `updateSettings` with an object literal missing the new fields — until Task 2 updates it, `tsc` will error there. If you want Task 1's `tsc` clean in isolation, also apply Task 2's route change now; otherwise run only the settings-test in Step 6 and defer the full `tsc` to Task 2. Prefer: make the route change here too (it's small) so `tsc` stays green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/settings.ts tests/lib/db/settings.test.ts
git commit -m "feat(settings): invoice contact fields (phone/address/email + show flags)"
```

---

### Task 2: Settings UI + PUT route for contact fields

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/components/SettingsForm.tsx`

**Interfaces:**
- Consumes: extended `Settings` (Task 1).
- Produces: PUT `/api/settings` accepts the six new fields; SettingsForm edits them.

- [ ] **Step 1: Update the PUT route**

In `src/app/api/settings/route.ts` PUT, after validating the numeric fields, extend the `updateSettings` call to persist the new fields:

```ts
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  updateSettings(db, {
    ownerSharePct, giveawayUnitCents, defaultShippingSuppliesCents, businessName,
    invoicePhone: str(body.invoicePhone),
    invoiceAddress: str(body.invoiceAddress),
    invoiceEmail: str(body.invoiceEmail),
    invoiceShowPhone: body.invoiceShowPhone !== false,
    invoiceShowAddress: body.invoiceShowAddress !== false,
    invoiceShowEmail: body.invoiceShowEmail !== false,
  });
```

(`businessName` is already computed above in the route; keep it. The `!== false` default means missing flags default to shown.)

- [ ] **Step 2: Add an Invoice section to SettingsForm**

In `src/components/SettingsForm.tsx`, add state for the six fields (initialized from `initial`), and render an "Invoice" block below the existing fields (still inside the same form + Card, or a second Card titled "Invoice"). Include them in the POST body. Concretely, add state:

```ts
  const [invoicePhone, setInvoicePhone] = useState(initial.invoicePhone ?? "");
  const [invoiceAddress, setInvoiceAddress] = useState(initial.invoiceAddress ?? "");
  const [invoiceEmail, setInvoiceEmail] = useState(initial.invoiceEmail ?? "");
  const [showPhone, setShowPhone] = useState(initial.invoiceShowPhone);
  const [showAddress, setShowAddress] = useState(initial.invoiceShowAddress);
  const [showEmail, setShowEmail] = useState(initial.invoiceShowEmail);
```

Add these to the fetch body in `save()`:

```ts
        invoicePhone: invoicePhone.trim() || null,
        invoiceAddress: invoiceAddress.trim() || null,
        invoiceEmail: invoiceEmail.trim() || null,
        invoiceShowPhone: showPhone, invoiceShowAddress: showAddress, invoiceShowEmail: showEmail,
```

Render (inside the form, before the Save button — reset `saved` on change, matching the existing fields' pattern), a labeled input + "show on invoice" checkbox per field, e.g.:

```tsx
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Invoice contact</p>
          {[
            { label: "Telephone", v: invoicePhone, setV: setInvoicePhone, show: showPhone, setShow: setShowPhone },
            { label: "Address", v: invoiceAddress, setV: setInvoiceAddress, show: showAddress, setShow: setShowAddress },
            { label: "Email", v: invoiceEmail, setV: setInvoiceEmail, show: showEmail, setShow: setShowEmail },
          ].map((f) => (
            <label key={f.label} className="mb-2 block">{f.label}
              <input className={`mt-1 w-full ${INPUT_CLASS}`} value={f.v}
                onChange={(e) => { f.setV(e.target.value); setSaved(false); }} />
              <span className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={f.show} onChange={(e) => { f.setShow(e.target.checked); setSaved(false); }} /> show on invoice
              </span>
            </label>
          ))}
        </div>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (this + Task 1 together resolve the `Settings` literal in the route).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/route.ts src/components/SettingsForm.tsx
git commit -m "feat(settings): edit invoice contact fields with show-on-invoice toggles"
```

---

### Task 3: Pure invoice PDF view-model

**Files:**
- Create: `src/lib/pdf/invoice-model.ts`
- Test: `tests/lib/pdf/invoice-model.test.ts`

**Interfaces:**
- Produces:
```ts
export interface InvoicePdfModel {
  heading: string; number: string;
  partyLabel: string; partyValue: string;
  date: string; unitLabel: string;
  lines: { qty: number; description: string; unitCents: number; amountCents: number }[];
  totalCents: number; contact: string[];
}
export function invoicePdfModel(invoice: Invoice, lines: InvoiceLine[], settings: Settings): InvoicePdfModel;
```
- Consumes: `Invoice`, `InvoiceLine` from `@/lib/db/invoices`; `Settings` from `@/lib/db/settings`; `longDate` from `@/lib/format-date`.

- [ ] **Step 1: Write failing tests**

```ts
// tests/lib/pdf/invoice-model.test.ts
import { describe, it, expect } from "vitest";
import { invoicePdfModel } from "@/lib/pdf/invoice-model";
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";
import type { Settings } from "@/lib/db/settings";

const baseSettings: Settings = {
  ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: "DirectDealzz",
  invoicePhone: "(313) 555-0142", invoiceAddress: "123 Warehouse Ave", invoiceEmail: "b@x.com",
  invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true,
};
const line = (over: Partial<InvoiceLine>): InvoiceLine => ({
  id: 1, invoiceId: 1, itemId: null, productName: "Widget", quantity: 2, unitCostCents: 100, unitPriceCents: 150, ...over,
});
const inv = (over: Partial<Invoice>): Invoice => ({
  id: 7, number: "INV-0007", direction: "sale", supplier: null, customer: "FE Wholesale",
  invoiceDate: "2026-07-19", notes: null, status: "posted", paid: false, paidOn: null, total: 300, ...over,
});

describe("invoicePdfModel", () => {
  it("sale: INVOICE / SOLD TO=customer / unit price", () => {
    const m = invoicePdfModel(inv({}), [line({ quantity: 2, unitPriceCents: 150 })], baseSettings);
    expect(m.heading).toBe("INVOICE");
    expect(m.partyLabel).toBe("SOLD TO");
    expect(m.partyValue).toBe("FE Wholesale");
    expect(m.unitLabel).toBe("Unit price");
    expect(m.lines[0]).toEqual({ qty: 2, description: "Widget", unitCents: 150, amountCents: 300 });
    expect(m.totalCents).toBe(300);
    expect(m.number).toBe("No. INV-0007");
    expect(m.date).toBe("July 19, 2026");
  });
  it("purchase: PURCHASE INVOICE / SUPPLIER=supplier / unit cost", () => {
    const m = invoicePdfModel(
      inv({ direction: "purchase", supplier: "Acme", customer: null }),
      [line({ quantity: 3, unitCostCents: 100 })], baseSettings);
    expect(m.heading).toBe("PURCHASE INVOICE");
    expect(m.partyLabel).toBe("SUPPLIER");
    expect(m.partyValue).toBe("Acme");
    expect(m.unitLabel).toBe("Unit cost");
    expect(m.lines[0]).toEqual({ qty: 3, description: "Widget", unitCents: 100, amountCents: 300 });
  });
  it("contact respects show-flags and emptiness", () => {
    expect(invoicePdfModel(inv({}), [], baseSettings).contact).toEqual(["(313) 555-0142", "123 Warehouse Ave", "b@x.com"]);
    expect(invoicePdfModel(inv({}), [], { ...baseSettings, invoiceShowEmail: false }).contact).toEqual(["(313) 555-0142", "123 Warehouse Ave"]);
    expect(invoicePdfModel(inv({}), [], { ...baseSettings, invoicePhone: null, invoiceShowAddress: false, invoiceShowEmail: false }).contact).toEqual([]);
  });
  it("missing party value renders empty string", () => {
    expect(invoicePdfModel(inv({ customer: null }), [], baseSettings).partyValue).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/lib/pdf/invoice-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/pdf/invoice-model.ts
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";
import type { Settings } from "@/lib/db/settings";
import { longDate } from "@/lib/format-date";

export interface InvoicePdfModel {
  heading: string;
  number: string;
  partyLabel: string;
  partyValue: string;
  date: string;
  unitLabel: string;
  lines: { qty: number; description: string; unitCents: number; amountCents: number }[];
  totalCents: number;
  contact: string[];
}

/** Pure, direction-aware view-model for the invoice PDF. */
export function invoicePdfModel(invoice: Invoice, lines: InvoiceLine[], settings: Settings): InvoicePdfModel {
  const isSale = invoice.direction === "sale";
  const modelLines = lines.map((l) => {
    const unitCents = isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents;
    return { qty: l.quantity, description: l.productName, unitCents, amountCents: l.quantity * unitCents };
  });
  const contact: string[] = [];
  if (settings.invoiceShowPhone && settings.invoicePhone) contact.push(settings.invoicePhone);
  if (settings.invoiceShowAddress && settings.invoiceAddress) contact.push(settings.invoiceAddress);
  if (settings.invoiceShowEmail && settings.invoiceEmail) contact.push(settings.invoiceEmail);
  return {
    heading: isSale ? "INVOICE" : "PURCHASE INVOICE",
    number: `No. ${invoice.number}`,
    partyLabel: isSale ? "SOLD TO" : "SUPPLIER",
    partyValue: (isSale ? invoice.customer : invoice.supplier) ?? "",
    date: longDate(invoice.invoiceDate),
    unitLabel: isSale ? "Unit price" : "Unit cost",
    lines: modelLines,
    totalCents: modelLines.reduce((s, l) => s + l.amountCents, 0),
    contact,
  };
}
```

- [ ] **Step 4: Run tests + typecheck + commit**

Run: `npx vitest run tests/lib/pdf/invoice-model.test.ts && npx tsc --noEmit` → PASS, clean.

```bash
git add src/lib/pdf/invoice-model.ts tests/lib/pdf/invoice-model.test.ts
git commit -m "feat(invoice-pdf): pure direction-aware view-model"
```

---

### Task 4: react-pdf component + route + Download button

Add the dependency, render the PDF, wire the button.

**Files:**
- Modify: `package.json` (add `@react-pdf/renderer`)
- Modify: `next.config.mjs` (serverExternalPackages)
- Create: `src/components/pdf/InvoicePdf.tsx`
- Create: `src/app/api/invoices/[id]/pdf/route.ts`
- Modify: `src/components/InvoiceActions.tsx` (Download PDF button)

**Interfaces:**
- Consumes: `invoicePdfModel` (Task 3), `getInvoice`/`listInvoiceLines` (`@/lib/db/invoices`), `getSettings`.
- Produces: `GET /api/invoices/[id]/pdf` → `application/pdf` attachment.

- [ ] **Step 1: Install the dependency**

Run: `npm install @react-pdf/renderer`
Expected: added to `dependencies` in `package.json`; `package-lock.json` updated.

- [ ] **Step 2: Configure Next to treat it as an external server package**

Read `next.config.mjs`. Add `serverExternalPackages: ["@react-pdf/renderer"]` to the config object (Next 15 top-level key). Keep any existing config (e.g. `output: "standalone"`). If the key already exists, append to its array.

- [ ] **Step 3: Create the PDF component**

```tsx
// src/components/pdf/InvoicePdf.tsx
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { InvoicePdfModel } from "@/lib/pdf/invoice-model";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

const s = StyleSheet.create({
  page: { paddingTop: 46, paddingBottom: 54, paddingHorizontal: 46, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  numberTR: { position: "absolute", top: 40, right: 46, fontSize: 11, fontFamily: "Helvetica-Bold" },
  title: { textAlign: "center", fontSize: 24, fontFamily: "Times-Bold", letterSpacing: 1 },
  contact: { textAlign: "center", fontSize: 8, color: "#333", marginTop: 4 },
  partyRow: { flexDirection: "row", borderWidth: 1, borderColor: "#111", marginTop: 18 },
  partyCell: { flex: 2, borderRightWidth: 1, borderColor: "#111", padding: 5 },
  dateCell: { flex: 1, padding: 5 },
  label: { fontSize: 7, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  value: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2 },
  tHead: { flexDirection: "row" },
  tHeadCell: { borderWidth: 1, borderColor: "#111", padding: 3, fontSize: 7, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row" },
  cell: { borderWidth: 1, borderColor: "#111", padding: "3 4", minHeight: 16, fontSize: 9 },
  cQty: { width: "10%", textAlign: "right" },
  cDesc: { flex: 1 },
  cUnit: { width: "16%", textAlign: "right" },
  cAmt: { width: "20%", textAlign: "right" },
  totalRow: { flexDirection: "row", marginTop: 0 },
  totalLabel: { width: "70%", textAlign: "right", padding: "4 4", fontFamily: "Helvetica-Bold" },
  totalVal: { width: "20%", borderWidth: 1, borderColor: "#111", textAlign: "right", padding: "4 4", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 30, left: 46, right: 46, textAlign: "center", fontSize: 7, color: "#888", borderTopWidth: 1, borderColor: "#eee", paddingTop: 5 },
});

const HeaderRow = () => (
  <View style={s.tHead} fixed>
    <Text style={[s.tHeadCell, s.cQty]}>QTY</Text>
    <Text style={[s.tHeadCell, s.cDesc]}>DESCRIPTION</Text>
    <Text style={[s.tHeadCell, s.cUnit]}>{"UNIT"}</Text>
    <Text style={[s.tHeadCell, s.cAmt]}>AMOUNT</Text>
  </View>
);

export function InvoicePdf({ model }: { model: InvoicePdfModel }) {
  const SPARE_ROWS = 3;
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <Text style={s.numberTR}>{model.number}</Text>
        <Text style={s.title}>{model.heading}</Text>
        {model.contact.length > 0 && <Text style={s.contact}>{model.contact.join("  ·  ")}</Text>}

        <View style={s.partyRow}>
          <View style={s.partyCell}>
            <Text style={s.label}>{model.partyLabel}</Text>
            <Text style={s.value}>{model.partyValue}</Text>
          </View>
          <View style={s.dateCell}>
            <Text style={s.label}>DATE</Text>
            <Text style={s.value}>{model.date}</Text>
          </View>
        </View>

        <View style={{ marginTop: 12 }}>
          {/* header repeats on each page via fixed */}
          <View style={s.tHead} fixed>
            <Text style={[s.tHeadCell, s.cQty]}>QTY</Text>
            <Text style={[s.tHeadCell, s.cDesc]}>DESCRIPTION</Text>
            <Text style={[s.tHeadCell, s.cUnit]}>{model.unitLabel.toUpperCase()}</Text>
            <Text style={[s.tHeadCell, s.cAmt]}>AMOUNT</Text>
          </View>
          {model.lines.map((l, i) => (
            <View style={s.row} key={i} wrap={false}>
              <Text style={[s.cell, s.cQty]}>{l.qty}</Text>
              <Text style={[s.cell, s.cDesc]}>{l.description}</Text>
              <Text style={[s.cell, s.cUnit]}>{money(l.unitCents)}</Text>
              <Text style={[s.cell, s.cAmt]}>{money(l.amountCents)}</Text>
            </View>
          ))}
          {Array.from({ length: SPARE_ROWS }).map((_, i) => (
            <View style={s.row} key={`spare-${i}`} wrap={false}>
              <Text style={[s.cell, s.cQty]}> </Text>
              <Text style={[s.cell, s.cDesc]}> </Text>
              <Text style={[s.cell, s.cUnit]}> </Text>
              <Text style={[s.cell, s.cAmt]}> </Text>
            </View>
          ))}
          <View style={s.totalRow} wrap={false}>
            <Text style={s.totalLabel}>TOTAL</Text>
            <Text style={s.totalVal}>{money(model.totalCents)}</Text>
          </View>
        </View>

        <Text style={s.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
```

(Remove the standalone `HeaderRow` helper if unused — the inline `fixed` header is the one that repeats. Keep the file self-consistent: delete `HeaderRow` since the component inlines its own header.)

- [ ] **Step 4: Create the PDF route**

```ts
// src/app/api/invoices/[id]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { dbForRequest } from "@/lib/auth/request";
import { getInvoice, listInvoiceLines } from "@/lib/db/invoices";
import { getSettings } from "@/lib/db/settings";
import { invoicePdfModel } from "@/lib/pdf/invoice-model";
import { InvoicePdf } from "@/components/pdf/InvoicePdf";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = await dbForRequest();
  const invoice = getInvoice(db, id);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const model = invoicePdfModel(invoice, listInvoiceLines(db, id), getSettings(db));
  const buffer = await renderToBuffer(<InvoicePdf model={model} />);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.number}.pdf"`,
    },
  });
}
```

Note: this route file uses JSX, so it must be `route.tsx` (not `.ts`). Create it as `src/app/api/invoices/[id]/pdf/route.tsx`.

- [ ] **Step 5: Wire the Download button**

In `src/components/InvoiceActions.tsx`, replace the "Generate" button:

```tsx
      <Button variant="secondary" href={`/api/invoices/${id}/pdf`}>Download PDF</Button>
```

(Keep everything else. The existing `/invoices/[id]/print` page may remain for on-screen viewing.)

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → builds; `/api/invoices/[id]/pdf` present in the route list, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json next.config.mjs src/components/pdf/InvoicePdf.tsx "src/app/api/invoices/[id]/pdf/route.tsx" src/components/InvoiceActions.tsx
git commit -m "feat(invoice-pdf): react-pdf document, /api/invoices/[id]/pdf route, Download button"
```

---

### Task 5: Verify end-to-end (incl. standalone build)

- [ ] **Step 1: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass; tsc clean.

- [ ] **Step 2: Runtime PDF generation**

Boot an isolated instance (fresh `DATA_DIR`, launch script started via `run_in_background` per the project's smoke pattern — do NOT symlink node_modules into a worktree). Create an admin, log in, then:
- Create a **sale** invoice with a customer + 2 lines; `curl` `GET /api/invoices/<id>/pdf` with the session cookie → response starts with the `%PDF-` magic bytes and Content-Type `application/pdf`. Save it and confirm it opens as a valid PDF with heading "INVOICE", the customer under SOLD TO, and a TOTAL.
- Create a **purchase** invoice with a supplier → the PDF heading reads "PURCHASE INVOICE", party label "SUPPLIER", unit column "UNIT COST".
- In Settings, set phone/address/email, untick "show on invoice" for email → regenerate → email absent from the contact strip.
- Add enough lines to overflow one page → confirm the PDF is multi-page with a repeated column header and a single TOTAL at the end, and "Page X of Y" footers.

- [ ] **Step 3: Standalone/Docker bundling check**

Confirm `@react-pdf/renderer` is traced into the standalone output:
`ls .next/standalone/node_modules/@react-pdf 2>/dev/null` (present) OR grep the server trace. If missing, add `@react-pdf/renderer` to `experimental.outputFileTracingIncludes` for the pdf route in `next.config.mjs` and rebuild. (Optional: a full `docker build` if the environment permits.)

- [ ] **Step 4: Commit any fixes; branch ready to merge**
