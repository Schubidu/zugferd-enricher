import { describe, expect, it } from "vitest";
import type { SourceLine } from "./model";
import { recognizeInvoice } from "./recognize";
import { checkTotals, parseCents, sumLineItemAmounts } from "./money";
import { reconcileInvoice } from "./reconcile";

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
    expect(draft.items).toHaveLength(0);
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
    const conflict = draft.warnings.find(x => /Widersprüchliche.*Brutto/i.test(x));
    expect(conflict).toContain("S. 1: 100,00");
    expect(conflict).toContain("S. 2: 200,00");
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


  it("links the TEST-05 no-VAT Kurtaxe statement to the exact printed line", () => {
    const draft = recognizeInvoice(pageLines(1, [
      "Rechnungsaussteller: Hotel Am Markt Test GmbH",
      "Rechnungsempfänger: Musterwerk Analytics UG",
      "Rechnungsnummer: HAM-2026-315",
      "Rechnungsdatum: 15.11.2026",
      "Logis 12.11.2026 1 x 105,00 105,00 7%",
      "Logis 13.11.2026 1 x 125,00 125,00 7%",
      "Logis 14.11.2026 1 x 118,00 118,00 7%",
      "Frühstück Speisen 3 x 14,00 42,00 7%",
      "Frühstück Getränke 3 x 5,00 15,00 19%",
      "Parken 2 x 8,00 16,00 19%",
      "Kurtaxe 3 x 3,50 10,50",
      "Summe der Positionen 431,50",
      "USt 7% Netto 390,00 Steuer 27,30",
      "USt 19% Netto 31,00 Steuer 5,89",
      "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,50",
      "Nettosumme 431,50",
      "Umsatzsteuer gesamt 33,19",
      "Gesamtbetrag 464,69",
    ]), 1);
    expect(draft.items).toHaveLength(7);
    expect(sumLineItemAmounts(draft.items).totalCents).toBe(43150n);
    const kurtaxe = draft.items.find(item => item.description === "Kurtaxe");
    expect(kurtaxe).toMatchObject({
      quantity:"3", unitPrice:"3,50", amount:"10,50", taxRate:null,
      taxTreatment:{kind:"third_party_no_vat",origin:"pdf",evidenceIds:["p1-14"]},
    });
    expect(draft.taxGroups.map(group => group.net)).toEqual(["390,00","31,00"]);
    expect(draft.fields.taxTotal?.value).toBe("33,19");
    expect(draft.fields.grossTotal?.value).toBe("464,69");
    expect(reconcileInvoice(draft)).toEqual([]);
    expect(draft.warnings).not.toEqual(expect.arrayContaining([expect.stringMatching(/keinen belegten Steuersatz/i)]));
  });

  it("does not infer no-VAT tax status from the word Kurtaxe alone or a conflicting note", () => {
    const description = "Kurtaxe 3 x 3,50 10,50";
    const exactNote = "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,50";
    const none = recognizeInvoice(pageLines(1,[description]),1);
    const wrongAmount = recognizeInvoice(pageLines(1,[
      description,
      "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,00",
    ]),1);
    const ambiguous = recognizeInvoice(pageLines(1,[description,exactNote,exactNote]),1);
    for (const draft of [none,wrongAmount,ambiguous]) {
      expect(draft.items).toHaveLength(1);
      expect(draft.items[0]?.taxTreatment).toBeUndefined();
      expect(draft.items[0]?.taxRate).toBeNull();
      expect(reconcileInvoice(draft)).toEqual(expect.arrayContaining([
        expect.objectContaining({id:"missing-tax-rates",severity:"review"}),
      ]));
    }
  });

});
