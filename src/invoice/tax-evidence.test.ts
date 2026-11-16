import { describe, expect, it } from "vitest";
import type { SourceLine } from "./model";
import { findSourceTaxEvidence, findTaxStatementMentions, isTaxExplanationLine, selectTaxEvidenceCandidates } from "./tax-evidence";

function lines(...entries: string[]): SourceLine[] {
  return entries.map((text, index) => ({
    id: "evidence-" + index, page: 1, text,
    box: {x: 0.1, y: index * 0.05, width: 0.7, height: 0.02},
  }));
}

describe("local contextual tax evidence candidate model", () => {
  it("receives PDF source lines and identifies candidate tax statements independently of item category", () => {
    const source = lines(
      "Kurtaxe 3 x 3,50 10,50",
      "USt 19% Netto 31,00 Steuer 5,89",
      "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,50",
      "Nettosumme 431,50",
    );
    expect(selectTaxEvidenceCandidates(source).map(line => line.id)).toContain("evidence-2");
    expect(findSourceTaxEvidence(source)).toEqual([
      {label: "kurtaxe", amountCents: 1050n, evidenceId: "evidence-2"},
    ]);
  });

  it("detects alternative source wording beyond the earlier exact Kurtaxe phrase", () => {
    const source = lines(
      "Ortstaxe im Namen der Stadt, keine Mehrwertsteuer: 6,00",
      "Beherbergungssteuer im Namen der Stadt ohne Mehrwertsteuer 12,00",
    );
    expect(findSourceTaxEvidence(source)).toEqual([
      {label: "ortstaxe", amountCents: 600n, evidenceId: "evidence-0"},
      {label: "beherbergungssteuer", amountCents: 1200n, evidenceId: "evidence-1"},
    ]);
  });

  it("never converts an ML candidate into tax evidence without a complete printed statement", () => {
    const candidates = lines(
      "Kurtaxe im Namen der Gemeinde mit 19% Umsatzsteuer: 10,50",
      "Kurtaxe im Namen der Gemeinde, nicht ohne Umsatzsteuer: 10,50",
      "Kurtaxe ohne Umsatzsteuer aber nicht im Namen der Gemeinde: 10,50",
      "Kurtaxe ohne Umsatzsteuer 10,50",
      "Ortstaxe 6,00",
      "USt 7% Netto 390,00 Steuer 27,30",
      "Frühstück im Namen der Gemeinde ohne MwSt: 15,00",
    );
    expect(findSourceTaxEvidence(candidates)).toEqual([]);
  });

  it("never treats a labelled tax explanation as an additional source line item", () => {
    expect(isTaxExplanationLine("Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,50")).toBe(true);
    expect(isTaxExplanationLine("Kurtaxe im Namen der Gemeinde, nicht ohne Umsatzsteuer: 10,50")).toBe(true);
    expect(isTaxExplanationLine("Kurtaxe 3 x 3,50 10,50")).toBe(false);
  });

  it("rejects explicit contradictory Mehrwertsteuer rates even next to no-VAT language", () => {
    const conflicting = lines(
      "Kurtaxe im Namen der Gemeinde, ohne Umsatzsteuer, mit 19% Mehrwertsteuer: 10,50",
      "Kurtaxe (inkl. Umsatzsteuer) 10,50",
    );
    expect(findSourceTaxEvidence(conflicting)).toEqual([]);
    expect(findTaxStatementMentions(conflicting)).toEqual([
      {label:"kurtaxe",amountCents:1050n,evidenceId:"evidence-0"},
      {label:"kurtaxe",amountCents:1050n,evidenceId:"evidence-1"},
    ]);
    expect(isTaxExplanationLine(conflicting[0]!.text)).toBe(true);
    expect(isTaxExplanationLine(conflicting[1]!.text)).toBe(false);
  });

  it("detects conflicting statements independently of whether the model selects them", () => {
    const source = lines(
      "Kurtaxe (im Namen der Gemeinde, ohne Umsatzsteuer): 10,50",
      "Kurtaxe im Namen der Gemeinde mit 19% Umsatzsteuer: 10,50",
    );
    expect(findSourceTaxEvidence(source)).toEqual([
      {label:"kurtaxe",amountCents:1050n,evidenceId:"evidence-0"},
    ]);
    expect(findTaxStatementMentions(source)).toHaveLength(2);
  });

});
