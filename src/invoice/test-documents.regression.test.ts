import { describe, expect, it } from "vitest";
import { recognizeInvoice } from "./recognize";
import { reconcileInvoice } from "./reconcile";
import { parseCents, sumLineItemAmounts } from "./money";
import type { SourceLine } from "./model";

/**
 * Invoice-relevant source text transcribed from the five actual synthetic PDF
 * test documents. Pages, dates, line item wording and taxes match the originals.
 * These are regression fixtures for the parser, not PDF.js-layout coverage.
 */
function source(pages: readonly (readonly string[])[]): SourceLine[] {
  return pages.flatMap((page, index) => page.map((text, row) => ({
    id: `pdf-${index + 1}-line-${row + 1}`,
    page: index + 1,
    text,
    box: {x: .1, y: .04 + row * .028, width: .75, height: .02},
  })));
}
const shared = (issuer: string, recipient: string, number: string, date = "15.11.2026") => [
  `Rechnungsaussteller: ${issuer}`,
  `Rechnungsempfänger: ${recipient}`,
  `Rechnungsnummer: ${number}`,
  `Rechnungsdatum: ${date}`,
];
const docs = [
  {
    id: "01",
    pages: [[
      ...shared("Nordlicht Digital GmbH","Beispiel Büroservice UG","ND-2026-001"),
      "Fälligkeitsdatum: 29.11.2026",
      "Beratungsleistung 2 x 80,00 160,00 19%",
      "USt 19% Netto 160,00 Steuer 30,40",
      "Nettosumme 160,00",
      "Umsatzsteuer gesamt 30,40",
      "Gesamtbetrag 190,40",
    ]],
    invoiceNumber:"ND-2026-001", count:1, net:"160,00", tax:"30,40", gross:"190,40",
    taxGroups:1, findings:[],
  },
  {
    id: "02",
    pages: [[
      "Seller: Atelier Papier & Technik",
      "Buyer: Musterwerk Forschung GmbH",
      "Invoice number: APT-2026-047",
      "Invoice date: November 15, 2026",
      "Due date: November 29, 2026",
      "Designhandbuch Band A 2 x 24,00 48,00 7%",
      "Fachbuch UI Patterns 1 x 56,00 56,00 7%",
      "Monitorhalterung 2 x 75,00 150,00 19%",
      "Installation vor Ort 3 x 64,00 192,00 19%",
    ],[
      "Rechnungsnummer: APT-2026-047",
      "USB-C Hub 1 x 60,00 60,00 19%",
      "Dokumentenmappe 4 x 17,00 68,00 19%",
      "USt 7% Netto 104,00 Steuer 7,28",
      "USt 19% Netto 470,00 Steuer 89,30",
      "Nettosumme 574,00",
      "Umsatzsteuer gesamt 96,58",
      "Gesamtbetrag 670,58",
    ]],
    invoiceNumber:"APT-2026-047", count:6, net:"574,00", tax:"96,58", gross:"670,58",
    taxGroups:2, findings:[],
  },
  {
    id: "03",
    pages: [[
      ...shared("Hotel Am Wiesenpark GmbH","Beispiel Beratung GmbH","HAW-2026-118"),
      "Fälligkeitsdatum: 22.11.2026",
      "Logis 2 x 115,00 230,00 7%",
      "Frühstücksbuffet Speisen 2 x 18,00 36,00 7%",
      "Tiefgarage 2 x 12,00 24,00 19%",
      "Mineralwasser 1 x 5,00 5,00 19%",
      "USt 7% Netto 266,00 Steuer 18,62",
      "USt 19% Netto 29,00 Steuer 5,51",
      "Nettosumme 295,00",
      "Umsatzsteuer gesamt 24,13",
      "Gesamtbetrag 319,13",
    ]],
    invoiceNumber:"HAW-2026-118", count:4, net:"295,00", tax:"24,13", gross:"319,13",
    taxGroups:2, findings:[],
  },
  {
    id: "04",
    pages: [[
      ...shared("Stadthotel Am Forum GmbH","Beispiel Software Solutions AG","SAF-2026-802"),
      "Fälligkeitsdatum: 30.11.2026",
      "Logis 10.11.2026 1 x 99,00 99,00 7%",
      "Logis 11.11.2026 1 x 129,00 129,00 7%",
      "Logis 12.11.2026 1 x 149,00 149,00 7%",
      "Logis 13.11.2026 1 x 109,00 109,00 7%",
      "Logis 14.11.2026 1 x 119,00 119,00 7%",
    ],[
      "Rechnungsnummer: SAF-2026-802",
      "Frühstück Speisen 5 x 17,00 85,00 7%",
      "Abendessen Speisen 1 x 28,00 28,00 7%",
      "Konferenzlunch 2 x 24,00 48,00 7%",
      "Parkhaus 5 x 16,00 80,00 19%",
      "Minibar Getränke 2 x 7,50 15,00 19%",
      "Espresso 2 x 4,50 9,00 19%",
      "WLAN Premium 1 x 10,00 10,00 19%",
    ],[
      "Rechnungsnummer: SAF-2026-802",
      "Business Paket 1 x 29,00 29,00",
      "USt 7% Netto 766,00 Steuer 53,62",
      "USt 19% Netto 143,00 Steuer 27,17",
      "Nettosumme 909,00",
      "Umsatzsteuer gesamt 80,79",
      "Gesamtbetrag 989,79",
    ]],
    invoiceNumber:"SAF-2026-802", count:13, net:"909,00", tax:"80,79", gross:"989,79",
    taxGroups:2, findings:["missing-tax-rates"],
  },
  {
    id: "05",
    pages: [[
      ...shared("Hotel Am Markt Test GmbH","Musterwerk Analytics UG","HAM-2026-315"),
      "Fälligkeitsdatum: 29.11.2026",
      "Logis 12.11.2026 1 x 105,00 105,00 7%",
      "Logis 13.11.2026 1 x 125,00 125,00 7%",
      "Logis 14.11.2026 1 x 118,00 118,00 7%",
      "Frühstück Speisen 3 x 14,00 42,00 7%",
      "Frühstück Getränke 3 x 5,00 15,00 19%",
      "Parken 2 x 8,00 16,00 19%",
      "Kurtaxe 3 x 3,50 10,50",
      "USt 7% Netto 390,00 Steuer 27,30",
      "USt 19% Netto 31,00 Steuer 5,89",
      "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,50",
      "Nettosumme 431,50",
      "Umsatzsteuer gesamt 33,19",
      "Gesamtbetrag 464,69",
    ]],
    invoiceNumber:"HAM-2026-315", count:7, net:"431,50", tax:"33,19", gross:"464,69",
    taxGroups:2, findings:[],
  },
] as const;

describe("five original synthetic test documents (source-backed regression)", () => {
  for (const doc of docs) {
    it(`TEST-${doc.id}: recovers printed amounts, positions and only actionable findings`, () => {
      const draft = recognizeInvoice(source(doc.pages), doc.pages.length);
      expect(draft.fields.invoiceNumber?.value).toBe(doc.invoiceNumber);
      expect(draft.fields.netTotal?.value).toBe(doc.net);
      expect(draft.fields.taxTotal?.value).toBe(doc.tax);
      expect(draft.fields.grossTotal?.value).toBe(doc.gross);
      expect(draft.items).toHaveLength(doc.count);
      expect(draft.taxGroups).toHaveLength(doc.taxGroups);
      expect(sumLineItemAmounts(draft.items).totalCents).toBe(parseCents(doc.net));
      const actual = reconcileInvoice(draft).map(f => f.id);
      expect(actual).toEqual([...doc.findings]);
      if (doc.id === "04") {
        expect(draft.items.find(item => item.description === "Business Paket")?.taxRate).toBeNull();
      }
      if (doc.id === "05") {
        expect(draft.items.find(item => item.description === "Kurtaxe")?.taxTreatment).toMatchObject({
          kind:"third_party_no_vat", origin:"pdf",
        });
      }
    });
  }
});
