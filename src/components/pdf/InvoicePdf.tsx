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
  piecesRow: { flexDirection: "row", marginTop: 4 },
  piecesText: { width: "80%", textAlign: "right", padding: "2 4", fontSize: 8, color: "#333" },
  totalRow: { flexDirection: "row", marginTop: 0 },
  totalLabel: { width: "70%", textAlign: "right", padding: "4 4", fontFamily: "Helvetica-Bold" },
  totalVal: { width: "20%", borderWidth: 1, borderColor: "#111", textAlign: "right", padding: "4 4", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 30, left: 46, right: 46, textAlign: "center", fontSize: 7, color: "#888", borderTopWidth: 1, borderColor: "#eee", paddingTop: 5 },
});

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
          <View style={s.piecesRow} wrap={false}>
            <Text style={s.piecesText}>Total pieces: {model.totalPieces}</Text>
          </View>
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
