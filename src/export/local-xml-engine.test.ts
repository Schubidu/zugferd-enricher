import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { recognizeInvoice } from "../invoice/recognize";
import type { InvoiceDraft, SourceLine } from "../invoice/model";
import { buildCiiCandidate } from "./cii-candidate";
import { VALIDATOR_RESOURCES } from "./validator-assets";
import type { ValidatorResources, ValidatorResourceName } from "./validator-assets";
import { validateCiiXmlLocally } from "./local-xml-engine";

const originalLines = [
  "Rechnungsaussteller: Haus & Söhne GmbH",
  "Rechnungsempfänger: Kunde <Partner> UG",
  "Rechnungsnummer: XML-2026-001",
  "Rechnungsdatum: 15.11.2026",
  "Leistungsdatum: 15.11.2026",
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

function fixture(): string {
  const source: SourceLine[] = originalLines.map((text,index) => ({
    id:"proof-" + index,page:1,text,box:{x:.1,y:.02*index,width:.7,height:.016},
  }));
  const invoice: InvoiceDraft = recognizeInvoice(source,1);
  const result = buildCiiCandidate(invoice,structuredClone(invoice));
  if (result.status !== "unvalidated") throw new Error("Synthetic CII generator not ready");
  return result.xml;
}
function localResources(): ValidatorResources {
  const result = new Map<ValidatorResourceName,Uint8Array>();
  for(const filename of Object.keys(VALIDATOR_RESOURCES) as ValidatorResourceName[]) {
    result.set(filename,new Uint8Array(readFileSync(resolve(
      "public","validation","ferd-2.5.2",filename,
    ))));
  }
  return result;
}

describe("real bundled EN16931 offline validation engines", () => {
  it("accepts the true synthetic CII with exact bundled XSD and both Schematron profiles", () => {
    expect(validateCiiXmlLocally(fixture(),localResources())).toEqual({
      status:"valid-xml-only",checkedProfiles:2,
    });
  });

  it("rejects arithmetic corruption despite otherwise well-formed XML", () => {
    const xml = fixture();
    for (const [from,to,rule] of [
      ["<ram:GrandTotalAmount>190.40</ram:GrandTotalAmount>",
        "<ram:GrandTotalAmount>190.41</ram:GrandTotalAmount>","BR-CO-15"],
      ["<ram:CalculatedAmount>30.40</ram:CalculatedAmount>",
        "<ram:CalculatedAmount>30.41</ram:CalculatedAmount>","BR-CO-14"],
      ["<ram:LineTotalAmount>160.00</ram:LineTotalAmount>",
        "<ram:LineTotalAmount>150.00</ram:LineTotalAmount>","BR-CO-10"],
    ]) {
      expect(xml).toContain(from);
      const result = validateCiiXmlLocally(xml.replace(from,to),localResources());
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") expect(result.failures.join(" ")).toContain(rule);
    }
  });

  it("rejects structural XSD corruption and unsafe XML", () => {
    const xml = fixture();
    const removedDocument = xml.replace(
      /<rsm:ExchangedDocument>[\s\S]*?<\/rsm:ExchangedDocument>/,"",
    );
    expect(validateCiiXmlLocally(removedDocument,localResources())).toMatchObject({
      status:"invalid",failures:["XSD_SCHEMA_VIOLATION"],
    });
    const dtd = "<!DOCTYPE invoice [<!ENTITY x SYSTEM 'https://remote.invalid'>]>" + xml;
    expect(validateCiiXmlLocally(dtd,localResources()).status).not.toBe("valid-xml-only");
  });

  it("cannot silently pass a missing official stylesheet or code-list resource", () => {
    const resources = localResources();
    resources.delete("FACTUR-X_EN16931.xslt");
    expect(validateCiiXmlLocally(fixture(),resources).status).toBe("unavailable");
    const incomplete = localResources();
    incomplete.delete("FACTUR-X_EN16931.xsd");
    expect(validateCiiXmlLocally(fixture(),incomplete).status).toBe("unavailable");
  });
});
