import { describe, expect, it } from "vitest";
import { recognizeInvoice } from "../invoice/recognize";
import type { InvoiceDraft, SourceLine } from "../invoice/model";
import { assessExportPreflight } from "./preflight";

function documentLines(lines: string[]): SourceLine[] {
  return lines.map((text, index) => ({
    id: `s-${index}`, page: 1, text,
    box: { x: 0.1, y: index / 30, width: 0.7, height: 0.02 },
  }));
}

function originalInvoice(overrides: string[] = []): InvoiceDraft {
  const lines = overrides.length ? overrides : [
    "Rechnungsaussteller: Nordlicht Digital GmbH",
    "Rechnungsempfänger: Testkunde GmbH",
    "Rechnungsnummer: ND-2026-001",
    "Rechnungsdatum: 16.11.2026",
    "Beratungsleistung 2 x 80,00 160,00 19%",
    "USt 19% Netto 160,00 Steuer 30,40",
    "Nettosumme 160,00",
    "Umsatzsteuer gesamt 30,40",
    "Gesamtbetrag 190,40",
  ];
  return recognizeInvoice(documentLines(lines), 1);
}

const codes = (draft: InvoiceDraft, review = draft) =>
  assessExportPreflight(draft, review).blockers.map(blocker => blocker.code);

function copy(invoice: InvoiceDraft): InvoiceDraft { return structuredClone(invoice); }

describe("Issue #5 source-faithful export preflight", () => {
  it("recognizes an unchanged extracted invoice yet never pretends it is export-ready", () => {
    const original = originalInvoice();
    const pristine = copy(original);
    const result = assessExportPreflight(original, copy(original));
    expect(result.sourceAligned).toBe(true);
    expect(result.exportAllowed).toBe(false);
    expect(result.blockers.filter(x => x.stage === "source")).toEqual([]);
    expect(result.blockers.map(x => x.code)).toEqual(expect.arrayContaining([
      "SOURCE_LINE_COVERAGE_UNVERIFIED", "CURRENCY_UNVERIFIED",
      "PARTY_ADDRESSES_UNVERIFIED", "INVOICE_TYPE_UNVERIFIED",
      "LINE_AMOUNT_BASIS_UNVERIFIED", "LINE_VAT_CATEGORY_UNVERIFIED",
      "XML_SCHEMA_VALIDATION_PENDING", "XML_BUSINESS_RULE_VALIDATION_PENDING",
      "PDFA3_VALIDATION_PENDING", "PDF_XML_FIDELITY_VALIDATION_PENDING",
    ]));
    expect(result.blockers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({code: "REQUIRED_FIELD_MISSING"}),
    ]));
    expect(original).toEqual(pristine);
  });

  it("rejects manually replaced amounts even when the visible value is identical", () => {
    const original = originalInvoice();
    const reviewed = copy(original);
    reviewed.fields.grossTotal = {
      ...reviewed.fields.grossTotal!, origin: "manual",
    };
    const result = assessExportPreflight(original, reviewed);
    expect(result.sourceAligned).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({
      stage: "source", code: "SOURCE_FIELD_CHANGED", path: "fields.grossTotal",
    }));
  });

  it("rejects altered values, identifiers and tax groups, even if labelled PDF-origin", () => {
    const original = originalInvoice();
    const changed = copy(original);
    changed.fields.invoiceNumber!.value = "SYNTHETIC-REPLACEMENT";
    changed.items[0]!.amount = "161,00";
    changed.taxGroups[0]!.tax = "30,59";
    const result = assessExportPreflight(original, changed);
    expect(result.sourceAligned).toBe(false);
    expect(result.blockers.map(x => x.code)).toEqual(expect.arrayContaining([
      "SOURCE_FIELD_CHANGED", "SOURCE_ITEM_CHANGED", "SOURCE_TAX_GROUP_CHANGED",
    ]));
    expect(original.fields.invoiceNumber?.value).toBe("ND-2026-001");
  });

  it("rejects changed source text and forged original data rather than trusting origin metadata", () => {
    const original = originalInvoice();
    const changed = copy(original);
    changed.sourceLines[0]!.text = "Rechnungsaussteller: Fremde GmbH";
    expect(codes(original, changed)).toContain("SOURCE_LINES_CHANGED");

    const forgedOriginal = copy(original);
    forgedOriginal.fields.invoiceNumber!.value = "NOT-IN-SOURCE";
    const forged = assessExportPreflight(forgedOriginal, copy(forgedOriginal));
    expect(forged.sourceAligned).toBe(false);
    expect(forged.blockers.map(x => x.code)).toEqual(expect.arrayContaining([
      "SOURCE_SNAPSHOT_INCONSISTENT", "SOURCE_EVIDENCE_INVALID",
    ]));
  });

  it("rejects missing invoice identifiers or parties, never guessing required fields", () => {
    const original = originalInvoice([
      "Rechnungsaussteller: Nordlicht Digital GmbH",
      "Beratungsleistung 2 x 80,00 160,00 19%",
      "Nettosumme 160,00",
      "Umsatzsteuer gesamt 30,40",
      "Gesamtbetrag 190,40",
    ]);
    const result = assessExportPreflight(original, original);
    expect(result.exportAllowed).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({code:"REQUIRED_FIELD_MISSING",path:"fields.recipient"}),
      expect.objectContaining({code:"REQUIRED_FIELD_MISSING",path:"fields.invoiceNumber"}),
      expect.objectContaining({code:"REQUIRED_FIELD_MISSING",path:"fields.invoiceDate"}),
    ]));
  });

  it("rejects conflicting source-backed totals and unresolved VAT allocations", () => {
    const original = originalInvoice([
      "Rechnungsaussteller: Beispiel GmbH",
      "Rechnungsempfänger: Kunde GmbH",
      "Rechnungsnummer: INV-1",
      "Rechnungsdatum: 16.11.2026",
      "Leistung 1 x 100,00 100,00 19%",
      "USt 19% Netto 100,00 Steuer 19,00",
      "Nettosumme 100,00",
      "Umsatzsteuer gesamt 19,00",
      "Gesamtbetrag 120,00",
    ]);
    expect(codes(original)).toEqual(expect.arrayContaining([
      "INVALID_TOTALS", "SOURCE_RECONCILIATION_FAILED",
    ]));
  });

  it("never treats a source-backed third-party Kurtaxe as an EN-16931 tax code", () => {
    const original = originalInvoice([
      "Rechnungsaussteller: Hotel Test GmbH",
      "Rechnungsempfänger: Muster GmbH",
      "Rechnungsnummer: HOTEL-7",
      "Rechnungsdatum: 16.11.2026",
      "Kurtaxe 3 x 3,50 10,50",
      "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,50",
      "Nettosumme 10,50",
      "Umsatzsteuer gesamt 0,00",
      "Gesamtbetrag 10,50",
    ]);
    expect(original.items).toHaveLength(1);
    expect(original.items[0]?.taxTreatment?.kind).toBe("third_party_no_vat");
    const report = assessExportPreflight(original, original);
    expect(report.exportAllowed).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({code:"LINE_VAT_CATEGORY_UNVERIFIED"}),
      expect.objectContaining({code:"LINE_AMOUNT_BASIS_UNVERIFIED"}),
    ]));
  });
});
