import { describe, expect, it } from "vitest";
import type { SourceLine } from "./model";
import { recognizeInvoice } from "./recognize";
import { checkTotals } from "./money";

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
    expect(draft.items[0].taxRate).toBeNull();
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
});
