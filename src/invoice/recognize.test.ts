import { describe, expect, it } from "vitest";
import type { SourceLine } from "./model";
import { recognizeInvoice } from "./recognize";
import { checkTotals, parseCents } from "./money";

function pageLines(page: number, entries: string[]): SourceLine[] {
  return entries.map((text, index) => ({
    id: "p" + page + "-" + index,
    page,
    text,
    box: { x: 0.07, y: 0.05 + index*0.04, width: 0.8, height: 0.02 },
  }));
}
describe("source-based invoice recognition", () => {
  it("reads explicit mixed 7%/19% hotel lines and tax group table across pages", () => {
    const lines = [
      ...pageLines(1, [
        "Rechnungsaussteller: Muster Hotel GmbH",
        "Rechnungsempfänger: Example AG",
        "Rechnungsnummer: H-2026-014",
        "Rechnungsdatum: 15.11.2026",
        "Logis 2 x 100,00 200,00 7%",
        "Frühstück 2 x 12,50 25,00 19%",
        "Parken 10,00 19%",
      ]),
      ...pageLines(2, [
        "USt 7% Netto 200,00 Steuer 14,00",
        "USt 19% Netto 35,00 Steuer 6,65",
        "Nettosumme 235,00",
        "Umsatzsteuer gesamt 20,65",
        "Gesamtbetrag 255,65",
      ]),
    ];
    const draft = recognizeInvoice(lines, 2);
    expect(draft.fields.invoiceNumber?.value).toBe("H-2026-014");
    expect(draft.fields.invoiceDate?.value).toBe("15.11.2026");
    expect(draft.fields.issuer?.value).toBe("Muster Hotel GmbH");
    expect(draft.fields.recipient?.value).toBe("Example AG");
    expect(draft.items).toHaveLength(3);
    expect(draft.items.map(x => x.taxRate)).toEqual(["7%", "19%", "19%"]);
    expect(draft.items[0]).toMatchObject({description:"Logis",quantity:"2",unitPrice:"100,00",amount:"200,00"});
    expect(draft.taxGroups).toEqual([
      {rate:"7%",net:"200,00",tax:"14,00",evidenceIds:["p2-0"]},
      {rate:"19%",net:"35,00",tax:"6,65",evidenceIds:["p2-1"]},
    ]);
    expect(draft.fields.grossTotal?.evidenceIds).toEqual(["p2-4"]);
    expect(draft.fields.grossTotal?.origin).toBe("pdf");
    expect(checkTotals(draft.fields.netTotal!.value,draft.fields.taxTotal!.value,draft.fields.grossTotal!.value).status).toBe("match");
  });

  it("keeps absent and ambiguous information unknown rather than allocating VAT", () => {
    const draft = recognizeInvoice(pageLines(1, [
      "Beleg Hotel", "Invoice date: 11/15/2026",
      "Business Paket 35,00",
      "Gesamtbetrag 1.234",
    ]), 1);
    expect(draft.fields.issuer).toBeNull();
    expect(draft.fields.invoiceDate).toBeNull();
    expect(draft.fields.grossTotal).toBeNull();
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]?.taxRate).toBeNull();
    expect(draft.taxGroups).toEqual([]);
    expect(draft.warnings.some(w => /Gesamtbetrag/i.test(w))).toBe(true);
  });

  it("does not infer recipient from a nearby unlabeled address or invent tax data", () => {
    const draft = recognizeInvoice(pageLines(1, [
      "Hotel Beispiel", "Gast: Jan Beispiel",
      "Invoice number: 2026-99",
      "Invoice date: November 15, 2026",
      "Grand total: 120.00",
    ]), 1);
    expect(draft.fields.recipient).toBeNull();
    expect(draft.fields.invoiceNumber?.value).toBe("2026-99");
    expect(draft.fields.invoiceDate?.value).toBe("November 15, 2026");
    expect(draft.fields.taxTotal).toBeNull();
    expect(draft.fields.netTotal).toBeNull();
    expect(draft.fields.grossTotal?.value).toBe("120.00");
  });

  it("reports empty text PDFs as needing OCR instead of claiming extraction", () => {
    const draft = recognizeInvoice([], 2);
    expect(draft.sourceLines).toHaveLength(0);
    expect(draft.warnings.some(x => /OCR/i.test(x))).toBe(true);
  });

  it("retains each original source line and exact page identifier for highlight", () => {
    const original = pageLines(3, ["Invoice number: XY-99"]);
    const draft = recognizeInvoice(original, 3);
    expect(draft.sourceLines).toEqual(original);
    expect(draft.fields.invoiceNumber?.evidenceIds).toEqual(["p3-0"]);
  });
  it("reads the whole amount with a space or nonbreaking-space thousands separator", () => {
    const normal = recognizeInvoice(pageLines(1, ["Gesamtbetrag 1 234,56"]), 1);
    const nonbreaking = recognizeInvoice(pageLines(1, ["Gesamtbetrag 1\u00a0234,56"]), 1);
    expect(parseCents(normal.fields.grossTotal!.value)).toBe(123456n);
    expect(parseCents(nonbreaking.fields.grossTotal!.value)).toBe(123456n);
    expect(recognizeInvoice(pageLines(1, ["Gesamtbetrag 1 23,56"]), 1).fields.grossTotal).toBeNull();
  });

  it("does not confuse supplier or customer IDs with legal party names", () => {
    const draft = recognizeInvoice(pageLines(1, [
      "Supplier number: S-17",
      "Customer number: C-23",
      "Supplier: Muster Hotel GmbH",
      "Customer: Beispiel AG",
    ]), 1);
    expect(draft.fields.issuer?.value).toBe("Muster Hotel GmbH");
    expect(draft.fields.recipient?.value).toBe("Beispiel AG");
    const onlyIds = recognizeInvoice(pageLines(1, ["Supplier number: S-17", "Customer ID: C-23"]), 1);
    expect(onlyIds.fields.issuer).toBeNull();
    expect(onlyIds.fields.recipient).toBeNull();
  });

  it("does not classify a Netto-Einzelpreis row as the invoice net total", () => {
    const draft = recognizeInvoice(pageLines(1, ["Netto-Einzelpreis 10,00", "Gesamtbetrag 119,00"]), 1);
    expect(draft.fields.netTotal).toBeNull();
    expect(draft.fields.grossTotal?.value).toBe("119,00");
  });

  it("preserves negative monetary totals for credits", () => {
    const draft = recognizeInvoice(pageLines(1, [
      "Nettosumme -9,00", "Steuerbetrag -1,00", "Gesamtbetrag -10,00",
    ]), 1);
    expect(draft.fields.netTotal?.value).toBe("-9,00");
    expect(draft.fields.taxTotal?.value).toBe("-1,00");
    expect(draft.fields.grossTotal?.value).toBe("-10,00");
    expect(checkTotals(draft.fields.netTotal!.value, draft.fields.taxTotal!.value, draft.fields.grossTotal!.value).status).toBe("match");
  });

  it("does not interpret printed gross amounts as a tax-group tax value", () => {
    const draft = recognizeInvoice(pageLines(1, [
      "USt 19% Netto 100,00 Brutto 119,00",
      "USt 19% Netto 100,00 Steuer 19,00",
    ]), 1);
    expect(draft.taxGroups).toEqual([
      {rate:"19%", net:"100,00", tax:"19,00", evidenceIds:["p1-1"]},
    ]);
    expect(draft.items).toHaveLength(0);
  });

  it("leaves a total unknown and warns when different source pages disagree", () => {
    const draft = recognizeInvoice([
      ...pageLines(1, ["Gesamtbetrag 100,00"]),
      ...pageLines(2, ["Gesamtbetrag 200,00"]),
    ], 2);
    expect(draft.fields.grossTotal).toBeNull();
    expect(draft.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Widersprüchliche.*Brutto/i)]));
  });

  it("accepts equivalent money totals across different locale formats", () => {
    const draft = recognizeInvoice([
      ...pageLines(1, ["Gesamtbetrag 1.000,00"]),
      ...pageLines(2, ["Gesamtbetrag 1,000.00"]),
    ], 2);
    expect(parseCents(draft.fields.grossTotal!.value)).toBe(100000n);
    expect(draft.warnings).not.toEqual(expect.arrayContaining([expect.stringMatching(/Widersprüchlich/i)]));
  });

  it("keeps a consumed total value on the next line out of invoice positions", () => {
    const draft = recognizeInvoice(pageLines(1, [
      "Grand total", "EUR 119.00", "Parking 10.00",
    ]), 1);
    expect(draft.fields.grossTotal?.value).toBe("EUR 119.00");
    expect(draft.fields.grossTotal?.evidenceIds).toEqual(["p1-0","p1-1"]);
    expect(draft.items.map(item => item.description)).toEqual(["Parking"]);
  });

  it("excludes printed VAT summaries but retains itemized Kurtaxe", () => {
    const draft = recognizeInvoice(pageLines(1, [
      "Service 100,00 19%",
      "MwSt 19% 19,00",
      "Kurtaxe 6,00",
    ]), 1);
    expect(draft.items.map(item => item.description)).toEqual(["Service","Kurtaxe"]);
    expect(draft.taxGroups).toEqual([]);
  });

});
