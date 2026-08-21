# Professional Purchase-Invoice Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the printable invoice (`Generate`) a clean, branding-free tax record: From (supplier) / To (business name) / Date, itemized lines, total, and a units summary.

**Architecture:** Add a `business_name` setting (the "To", set once). Add a null-safe `longDate` formatter. Rewrite `InvoiceDocument` to the approved layout and feed it the business name from settings in the invoice page and print page.

**Tech Stack:** Next.js App Router (server components), better-sqlite3, React, Tailwind, vitest. Spec: `docs/superpowers/specs/2026-06-15-invoice-document-polish-design.md`.

---

### Task 1: `business_name` setting (schema, migration, repo)

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/connection.ts`
- Modify: `src/lib/db/settings.ts`
- Test: `tests/lib/db/settings.test.ts`

- [ ] **Step 1: Update the failing tests**

In `tests/lib/db/settings.test.ts`, the two existing assertions use exact `toEqual`, so they must include the new field. Replace the two `it(...)` blocks with:

```ts
  it("returns the seeded defaults", () => {
    expect(getSettings(db)).toEqual({
      ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
    });
  });

  it("updates and reads back", () => {
    updateSettings(db, { ownerSharePct: 70, giveawayUnitCents: 400, defaultShippingSuppliesCents: 250, businessName: "DirectDealzz" });
    expect(getSettings(db)).toEqual({
      ownerSharePct: 70, giveawayUnitCents: 400, defaultShippingSuppliesCents: 250, businessName: "DirectDealzz",
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/settings.test.ts`
Expected: FAIL — `businessName` missing from the returned object / not accepted by `updateSettings`.

- [ ] **Step 3: Add the column and update the repo**

In `src/lib/db/schema.ts`, change the `app_settings` table definition to add a `business_name` column (so fresh DBs have it). It should read:

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_share_pct INTEGER NOT NULL DEFAULT 80,
  giveaway_unit_cents INTEGER NOT NULL DEFAULT 500,
  default_shipping_supplies_cents INTEGER NOT NULL DEFAULT 0,
  business_name TEXT
);
```

In `src/lib/db/connection.ts`, add this idempotent migration inside `migrate(db)` (for existing DBs):

```ts
  const scols = (db.prepare("PRAGMA table_info(app_settings)").all() as { name: string }[]).map((c) => c.name);
  if (!scols.includes("business_name")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN business_name TEXT");
  }
```

In `src/lib/db/settings.ts`, add `businessName` to the interface and both queries:

```ts
export interface Settings {
  ownerSharePct: number;
  giveawayUnitCents: number;
  defaultShippingSuppliesCents: number;
  businessName: string | null;
}

export function getSettings(db: DB): Settings {
  const r = db.prepare(`SELECT owner_share_pct as ownerSharePct,
    giveaway_unit_cents as giveawayUnitCents,
    default_shipping_supplies_cents as defaultShippingSuppliesCents,
    business_name as businessName
    FROM app_settings WHERE id = 1`).get() as Settings | undefined;
  if (!r) throw new Error("app_settings row is missing");
  return r;
}

export function updateSettings(db: DB, s: Settings): void {
  db.prepare(`UPDATE app_settings SET owner_share_pct = ?,
    giveaway_unit_cents = ?, default_shipping_supplies_cents = ?, business_name = ? WHERE id = 1`)
    .run(s.ownerSharePct, s.giveawayUnitCents, s.defaultShippingSuppliesCents, s.businessName);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/db/settings.test.ts && npx vitest run`
Expected: PASS — settings tests green and the full suite still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/settings.ts tests/lib/db/settings.test.ts
git commit -m "feat(settings): business_name (the invoice 'To')"
```

---

### Task 2: Settings route + form accept the business name

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/components/SettingsForm.tsx`

No test (thin route + UI).

- [ ] **Step 1: Pass businessName through the PUT route**

In `src/app/api/settings/route.ts`, the `PUT` handler currently validates the three numbers and calls `updateSettings` with them. Add `businessName` (string or null) to the `updateSettings` call. Replace the `updateSettings(...)` line with:

```ts
  const businessName = typeof body.businessName === "string" && body.businessName.trim() ? body.businessName.trim() : null;
  updateSettings(getDb(), { ownerSharePct, giveawayUnitCents, defaultShippingSuppliesCents, businessName });
```

- [ ] **Step 2: Add the Business name field to the form**

In `src/components/SettingsForm.tsx`:

1. Add state seeded from the initial value, after the existing `shipping` state:

```tsx
  const [businessName, setBusinessName] = useState(initial.businessName ?? "");
```

2. Add `businessName` to the PUT body in `save()` (alongside the other fields):

```tsx
        businessName: businessName.trim() || null,
```

3. Add the input inside the form, before the submit row (after the shipping `<label>`):

```tsx
        <label className="block">Business name (shown as “To” on invoices)
          <input className={`mt-1 w-full ${INPUT_CLASS}`} value={businessName} onChange={(e) => { setBusinessName(e.target.value); setSaved(false); }} />
        </label>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/route.ts src/components/SettingsForm.tsx
git commit -m "feat(settings): edit business name on the Settings page"
```

---

### Task 3: `longDate` formatter

**Files:**
- Create: `src/lib/format-date.ts`
- Test: `tests/lib/format-date.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/format-date.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { longDate } from "@/lib/format-date";

describe("longDate", () => {
  it("formats a YYYY-MM-DD date as a long date", () => {
    expect(longDate("2026-06-15")).toBe("June 15, 2026");
  });
  it("does not zero-pad the day", () => {
    expect(longDate("2026-06-05")).toBe("June 5, 2026");
  });
  it("returns an em dash for null/empty/unparseable", () => {
    expect(longDate(null)).toBe("—");
    expect(longDate("")).toBe("—");
    expect(longDate("nope")).toBe("—");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/format-date.test.ts`
Expected: FAIL — cannot find module `@/lib/format-date`.

- [ ] **Step 3: Implement**

Create `src/lib/format-date.ts`:

```ts
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** "2026-06-15" -> "June 15, 2026". Parses the parts directly (no Date, so no
 *  timezone drift). Returns "—" for null/empty/unparseable input. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  const name = MONTHS[Number(m[2]) - 1];
  if (!name) return "—";
  return `${name} ${Number(m[3])}, ${m[1]}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/lib/format-date.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format-date.ts tests/lib/format-date.test.ts
git commit -m "feat: longDate formatter (YYYY-MM-DD -> 'June 15, 2026')"
```

---

### Task 4: Redesign `InvoiceDocument` + wire it into the pages

**Files:**
- Modify: `src/components/InvoiceDocument.tsx`
- Modify: `src/app/invoices/[id]/page.tsx`
- Modify: `src/app/invoices/[id]/print/page.tsx`

No test (presentational). Done in one task so the new required `businessName` prop is added and supplied to every caller together (the tree stays green).

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/InvoiceDocument.tsx` with:

```tsx
import { Money } from "@/components/Money";
import { longDate } from "@/lib/format-date";
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";

/** Read-only, branding-free purchase-invoice document: From (supplier) / To
 *  (business name) / Date, itemized lines, total, and a units summary. Used by
 *  the posted view and the print page. Shows a DRAFT marker when not posted. */
export function InvoiceDocument({ invoice, lines, businessName }: {
  invoice: Invoice; lines: InvoiceLine[]; businessName: string | null;
}) {
  const total = lines.reduce((s, l) => s + l.quantity * l.unitCostCents, 0);
  const units = lines.reduce((s, l) => s + l.quantity, 0);

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-medium text-slate-800">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6 text-slate-800">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Purchase Invoice</h1>
        <div className="text-sm text-slate-500">{invoice.number}</div>
        {invoice.status === "draft" && (
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">Draft</span>
        )}
      </div>

      <div className="flex flex-wrap gap-8">
        <Field label="From (supplier)" value={invoice.supplier ?? "—"} />
        <Field label="To" value={businessName ?? "—"} />
        <Field label="Date" value={longDate(invoice.invoiceDate)} />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="border-b-2 border-slate-800 py-1.5">Product</th>
            <th className="border-b-2 border-slate-800 py-1.5 text-right">Qty</th>
            <th className="border-b-2 border-slate-800 py-1.5 text-right">Unit cost</th>
            <th className="border-b-2 border-slate-800 py-1.5 text-right">Line total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="py-2">{l.productName}</td>
              <td className="py-2 text-right tabular-nums">{l.quantity}</td>
              <td className="py-2 text-right tabular-nums"><Money cents={l.unitCostCents} /></td>
              <td className="py-2 text-right tabular-nums"><Money cents={l.quantity * l.unitCostCents} /></td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="border-t-2 border-slate-800 py-2.5" colSpan={3}>Total</td>
            <td className="border-t-2 border-slate-800 py-2.5 text-right tabular-nums"><Money cents={total} /></td>
          </tr>
          <tr>
            <td className="pt-1 text-sm text-slate-500" colSpan={4}>
              {units} {units === 1 ? "unit" : "units"} across {lines.length} {lines.length === 1 ? "product" : "products"}
            </td>
          </tr>
        </tbody>
      </table>

      {invoice.notes && <p className="text-sm text-slate-500">{invoice.notes}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Pass businessName in the invoice page**

In `src/app/invoices/[id]/page.tsx`, add `import { getSettings } from "@/lib/db/settings";` near the other imports. After the `db` is obtained, read the business name (place it next to the existing `items` line):

```tsx
  const businessName = getSettings(db).businessName;
```

Then update the `InvoiceDocument` usage in the posted branch to pass it:

```tsx
          : <InvoiceDocument invoice={invoice} lines={lines} businessName={businessName} />}
```

- [ ] **Step 3: Pass businessName in the print page**

In `src/app/invoices/[id]/print/page.tsx`, add `import { getSettings } from "@/lib/db/settings";`. After loading the invoice, pass the business name to the document:

```tsx
      <InvoiceDocument invoice={invoice} lines={listInvoiceLines(db, id)} businessName={getSettings(db).businessName} />
```

- [ ] **Step 4: Full verification sweep**

Run: `npx tsc --noEmit`
Expected: no errors (the required prop is now provided everywhere).

Run: `npx vitest run`
Expected: all pass.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/InvoiceDocument.tsx "src/app/invoices/[id]/page.tsx" "src/app/invoices/[id]/print/page.tsx"
git commit -m "feat(invoices): redesign InvoiceDocument with From/To/Date + business name"
```
