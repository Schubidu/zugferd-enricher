import { describe, expect, it } from "vitest";
import { recognizeInvoice } from "./recognize";
import { reconcileInvoice } from "./reconcile";
import type { SourceLine } from "./model";

function line(page: number, row: number, text: string): SourceLine {
  return {id:`p${page}-r${row}`,page,text,box:{x:.1,y:row*.04,width:.7,height:.02}};
}

describe("printed amount basis and precise net reconciliation", () => {
  it("links NETTO column heading to subsequent item lines on the same PDF page", () => {
    const draft = recognizeInvoice([
      line(1,1,"LEISTUNG / ARTIKEL - MENGE x EINZELPREIS = NETTOBETRAG - UST"),
      line(1,2,"Logis 2 x 100,00 200,00 7%"),
      line(1,3,"USt 7% Netto 200,00 Steuer 14,00"),
      line(1,4,"Nettosumme 200,00"),
      line(1,5,"Umsatzsteuer gesamt 14,00"),
      line(1,6,"Gesamtbetrag 214,00"),
    ],1);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]?.amountBasis).toEqual({
      kind:"net",origin:"pdf",evidenceIds:["p1-r1"],
    });
    expect(reconcileInvoice(draft).some(f => f.id === "item-net-sum")).toBe(false);
  });

  it("does not carry a NETTO heading to the next PDF page", () => {
    const draft = recognizeInvoice([
      line(1,1,"LEISTUNG / ARTIKEL - MENGE x EINZELPREIS = NETTOBETRAG - UST"),
      line(1,2,"Hotel 1 x 100,00 100,00 7%"),
      line(2,1,"Parking 1 x 20,00 20,00 19%"),
      line(2,2,"Nettosumme 120,00"),
      line(2,3,"Umsatzsteuer gesamt 10,80"),
      line(2,4,"Gesamtbetrag 130,80"),
    ],2);
    expect(draft.items.map(item => item.amountBasis?.kind ?? null)).toEqual(["net",null]);
  });

  it("does not infer a net basis from VAT percentages or an explicitly gross-priced heading", () => {
    const draft = recognizeInvoice([
      line(1,1,"LEISTUNG - MENGE x EINZELPREIS = BRUTTOBETRAG - UST"),
      line(1,2,"Service 1 x 100,00 100,00 19%"),
      line(1,3,"Nettosumme 100,00"),
      line(1,4,"Umsatzsteuer gesamt 19,00"),
      line(1,5,"Gesamtbetrag 119,00"),
    ],1);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]?.amountBasis).toBeUndefined();
    expect(reconcileInvoice(draft).some(f => f.id === "item-net-sum")).toBe(false);
  });

  it("flags mismatch between fully evidenced net positions and printed net total", () => {
    const draft = recognizeInvoice([
      line(1,1,"LEISTUNG - MENGE x EINZELPREIS = NETTOBETRAG - UST"),
      line(1,2,"Service 1 x 100,00 100,00 19%"),
      line(1,3,"USt 19% Netto 120,00 Steuer 22,80"),
      line(1,4,"Nettosumme 120,00"),
      line(1,5,"Umsatzsteuer gesamt 22,80"),
      line(1,6,"Gesamtbetrag 142,80"),
    ],1);
    expect(reconcileInvoice(draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({id:"item-net-sum",severity:"review"}),
    ]));
    expect(draft.items[0]?.amount).toBe("100,00");
  });
});
