import { describe, expect, it } from "vitest";
import { recognizeInvoice } from "../invoice/recognize";
import type { InvoiceDraft, SourceLine } from "../invoice/model";
import { buildCiiCandidate } from "./cii-candidate";
import { extractCiiSourceFacts } from "./cii-evidence";

function invoice(lines: string[]): InvoiceDraft {
  const source: SourceLine[] = lines.map((text, row) => ({
    id: "pdf-" + row, page: 1, text,
    box: {x:0.1, y:.025 * row, width:.7, height:.02},
  }));
  return recognizeInvoice(source, 1);
}

const originalLines = [
  "Rechnungsaussteller: Haus & Söhne GmbH",
  "Rechnungsempfänger: Kunde <Partner> UG",
  "Rechnungsnummer: XML-2026-001",
  "Rechnungsdatum: 15.11.2026",
  "Fälligkeitsdatum: 29.11.2026",
  "Rechnungswährung: EUR",
  "Rechnungstypcode: 380",
  "Aussteller Straße: Uferweg & Ring 12",
  "Aussteller PLZ: 12345",
  "Aussteller Ort: Berlin",
  "Aussteller Ländercode: DE",
  "Aussteller USt-ID: DE123456789",
  "Empfänger Straße: Marktstraße 1",
  "Empfänger PLZ: 54321",
  "Empfänger Ort: Bremen",
  "Empfänger Ländercode: DE",
  "LEISTUNG - MENGE x EINZELPREIS = NETTOBETRAG - UST",
  "Beratungsleistung & Audit 2 x 80,00 160,00 19%",
  "Position 1 USt-Kategorie: S | Position: Beratungsleistung & Audit | Betrag: 160,00",
  "Position 1 Einheit: C62 | Position: Beratungsleistung & Audit | Betrag: 160,00",
  "USt 19% Netto 160,00 Steuer 30,40",
  "Nettosumme 160,00",
  "Umsatzsteuer gesamt 30,40",
  "Gesamtbetrag 190,40",
  "Zahlbetrag: 190,40",
];

function candidate(lines = originalLines, reviewed?: InvoiceDraft) {
  const original = invoice(lines);
  return buildCiiCandidate(original, reviewed ?? structuredClone(original));
}

describe("EN16931 internal CII XML preparation (never a certified export)", () => {
  it("requires explicit PDF source evidence and escapes XML special characters", () => {
    const original = invoice(originalLines);
    expect(original.items).toHaveLength(1);
    expect(original.items[0]?.description).toBe("Beratungsleistung & Audit");
    const facts = extractCiiSourceFacts(original);
    expect(facts.ok).toBe(true);

    const result = buildCiiCandidate(original, structuredClone(original));
    expect(result.status).toBe("unvalidated");
    if (result.status !== "unvalidated") return;
    expect(result.profile).toBe("EN16931");
    expect(result.xml).toContain("urn:cen.eu:en16931:2017");
    expect(result.xml).toContain("<ram:ID>XML-2026-001</ram:ID>");
    expect(result.xml).toContain("<ram:Name>Haus &amp; Söhne GmbH</ram:Name>");
    expect(result.xml).toContain("<ram:Name>Kunde &lt;Partner&gt; UG</ram:Name>");
    expect(result.xml).toContain("<ram:LineOne>Uferweg &amp; Ring 12</ram:LineOne>");
    expect(result.xml).toContain("<ram:Name>Beratungsleistung &amp; Audit</ram:Name>");
    expect(result.xml).toContain('<ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity>');
    expect(result.xml).toContain("<ram:CategoryCode>S</ram:CategoryCode>");
    expect(result.xml).toContain("<ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>");
    expect(result.xml).toContain("<ram:LineTotalAmount>160.00</ram:LineTotalAmount>");
    expect(result.xml).toContain("<ram:TaxBasisTotalAmount>160.00</ram:TaxBasisTotalAmount>");
    expect(result.xml).toContain('<ram:TaxTotalAmount currencyID="EUR">30.40</ram:TaxTotalAmount>');
    expect(result.xml).toContain("<ram:GrandTotalAmount>190.40</ram:GrandTotalAmount>");
    expect(result.xml).toContain("<ram:DuePayableAmount>190.40</ram:DuePayableAmount>");
    expect(result.xml).toContain('format="102">20261115</udt:DateTimeString>');
    const parsed = new DOMParser().parseFromString(result.xml, "application/xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.documentElement.localName).toBe("CrossIndustryInvoice");
    expect(parsed.getElementsByTagName("ram:IncludedSupplyChainTradeLineItem")).toHaveLength(1);
  });

  it("keeps all five original synthetic invoices blocked with missing EN16931 source data", () => {
    const lines = [
      "Rechnungsaussteller: Nordlicht Digital GmbH",
      "Rechnungsempfänger: Beispiel Büroservice UG",
      "Rechnungsnummer: ND-2026-001",
      "Rechnungsdatum: 15.11.2026",
      "LEISTUNG / ARTIKEL - MENGE x EINZELPREIS = NETTOBETRAG - UST",
      "Beratungsleistung 2 x 80,00 160,00 19%",
      "USt 19% Netto 160,00 Steuer 30,40",
      "Nettosumme 160,00",
      "Umsatzsteuer gesamt 30,40",
      "Gesamtbetrag 190,40",
    ];
    const result = candidate(lines);
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.reasons).toContain("EVIDENCE:currency");
    expect(result.reasons).toContain("EVIDENCE:typeCode");
    expect(result.reasons).toContain("EVIDENCE:sellerStreet");
    expect(result.reasons).toContain("EVIDENCE:items.0.vatCategory");
    expect(result.reasons).toContain("EVIDENCE:payable");
  });

  it("rejects an explicitly different currency/type and conflicting duplicate claims", () => {
    for (const changes of [
      originalLines.map(l => l === "Rechnungswährung: EUR" ? "Rechnungswährung: USD" : l),
      originalLines.map(l => l === "Rechnungstypcode: 380" ? "Rechnungstypcode: 381" : l),
      [...originalLines, "Rechnungswährung: EUR"],
    ]) {
      expect(candidate(changes).status).toBe("blocked");
    }
  });

  it("rejects a VAT category missing its exact source-item description or amount", () => {
    const altered = originalLines.map(l => l.startsWith("Position 1 USt-Kategorie:")
      ? "Position 1 USt-Kategorie: S | Position: Andere Leistung | Betrag: 160,00" : l);
    const result = candidate(altered);
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.reasons).toContain("EVIDENCE:items.0.vatCategory");
  });

  it("does not turn the tax percentage or a source-backed municipal tax into a category S", () => {
    const none = originalLines.filter(l => !l.startsWith("Position 1 USt-Kategorie:"));
    expect(candidate(none).status).toBe("blocked");

    const municipal = invoice([
      ...originalLines.filter(l => !l.startsWith("Position 1 USt-Kategorie:")),
      "Kurtaxe 1 x 3,50 3,50",
      "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 3,50",
    ]);
    expect(buildCiiCandidate(municipal, structuredClone(municipal)).status).toBe("blocked");
  });

  it("blocks manual changes, including unchanged-looking values with manual provenance", () => {
    const original = invoice(originalLines);
    const reviewed = structuredClone(original);
    reviewed.fields.netTotal = {...reviewed.fields.netTotal!, origin:"manual"};
    const result = buildCiiCandidate(original,reviewed);
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.reasons).toContain("SOURCE_FIELD_CHANGED:fields.netTotal");
  });

  it("blocks fabricated payable amounts and contradictory arithmetic", () => {
    const payable = originalLines.map(l =>
      l === "Zahlbetrag: 190,40" ? "Zahlbetrag: 180,40" : l);
    const payableResult = candidate(payable);
    expect(payableResult.status).toBe("blocked");
    if (payableResult.status === "blocked") expect(payableResult.reasons).toContain("AMOUNTS:payable");

    const groupTax = originalLines.map(l =>
      l === "USt 19% Netto 160,00 Steuer 30,40" ?
        "USt 19% Netto 160,00 Steuer 30,39" : l);
    expect(candidate(groupTax).status).toBe("blocked");
  });

  it("blocks unsupported quantity, ambiguous addresses and illegal XML characters", () => {
    const noQty = originalLines.map(l => l.startsWith("Beratungsleistung & Audit ") ?
      "Beratungsleistung & Audit 160,00 19%" : l);
    expect(candidate(noQty).status).toBe("blocked");
    expect(candidate([...originalLines,"Aussteller PLZ: 12345"]).status).toBe("blocked");
    const invalid = originalLines.map(l => l === "Rechnungsaussteller: Haus & Söhne GmbH" ?
      "Rechnungsaussteller: Haus \u0001 GmbH" : l);
    const result = candidate(invalid);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.reasons).toContain("XML:illegal-source-character");
  });

  it("creates separate standard-rate VAT groups using exact integer arithmetic", () => {
    const source = originalLines.flatMap(line => {
      if (line === "USt 19% Netto 160,00 Steuer 30,40") return [
        "Parken 1 x 10,00 10,00 7%",
        "Position 2 USt-Kategorie: S | Position: Parken | Betrag: 10,00",
        "Position 2 Einheit: C62 | Position: Parken | Betrag: 10,00",
        "USt 19% Netto 160,00 Steuer 30,40",
        "USt 7% Netto 10,00 Steuer 0,70",
      ];
      if (line === "Nettosumme 160,00") return ["Nettosumme 170,00"];
      if (line === "Umsatzsteuer gesamt 30,40") return ["Umsatzsteuer gesamt 31,10"];
      if (line === "Gesamtbetrag 190,40") return ["Gesamtbetrag 201,10"];
      if (line === "Zahlbetrag: 190,40") return ["Zahlbetrag: 201,10"];
      return [line];
    });
    const result = candidate(source);
    expect(result.status).toBe("unvalidated");
    if (result.status !== "unvalidated") return;
    expect(result.xml.match(/<ram:IncludedSupplyChainTradeLineItem>/g)).toHaveLength(2);
    expect(result.xml.match(/<ram:CalculatedAmount>/g)).toHaveLength(2);
    expect(result.xml).toContain("<ram:TaxBasisTotalAmount>170.00</ram:TaxBasisTotalAmount>");
    expect(result.xml).toContain("<ram:GrandTotalAmount>201.10</ram:GrandTotalAmount>");
  });
});
