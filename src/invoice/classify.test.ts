import { describe, expect, it } from "vitest";
import { classifyDescription, classifyItems } from "./classify";
import type { LineItem } from "./model";

const examples: Array<[string,string]> = [
  ["Übernachtung 14.11.", "accommodation"],
  ["Logis Einzelzimmer", "accommodation"],
  ["Breakfast food", "food"],
  ["Frühstück Speisen", "food"],
  ["Mineralwasser Getränke", "beverage"],
  ["Coffee", "beverage"],
  ["Parken Garage", "parking"],
  ["Parking", "parking"],
  ["Kurtaxe", "city_tax"],
  ["Beherbergungssteuer", "city_tax"],
  ["Business Paket", "bundle"],
  ["Arrangement", "bundle"],
];
describe("conservative source-separated classification", () => {
  it.each(examples)("applies explicit high-precision rules: %s", (text, expected) => {
    expect(classifyDescription(text)).toMatchObject({category:expected,source:"rule"});
  });
  it("abstains on mixed services and unfamiliar descriptions", () => {
    expect(classifyDescription("Frühstück und Getränke").category).toBe("unknown");
    expect(classifyDescription("X5 Zusatz")).toMatchObject({category:"unknown",source:"abstain"});
  });
  it("accepts a confident, unambiguous local model prediction", () => {
    expect(classifyDescription("Cappuccino Frühstücksset", [
      {category:"beverage", probability:0.92},{category:"food",probability:0.03},
    ])).toMatchObject({category:"beverage",source:"fasttext",confidence:0.92});
  });
  it("rejects low confidence, narrow margins and unsupported model labels", () => {
    expect(classifyDescription("Mystery A",[
      {category:"parking",probability:0.8},{category:"food",probability:0.15},
    ]).category).toBe("unknown");
    expect(classifyDescription("Mystery B",[
      {category:"parking",probability:0.9},{category:"food",probability:0.75},
    ]).category).toBe("unknown");
    expect(classifyDescription("Mystery C",[{category:"not_a_category",probability:0.99}]).category).toBe("unknown");
  });
  it("never overwrites a contradicting pair of explicit rules with ML", () => {
    expect(classifyDescription("Dinner und Getränke",[{category:"food",probability:0.999}]).category).toBe("unknown");
  });
  it("does not use extracted amounts, tax rates or currency to infer categories", () => {
    const item: LineItem = {
      id:"a", description:"Kurtaxe", amount:"10,00", taxRate:"19%", quantity:null,
      unitPrice:null,evidenceIds:["page-1-line-1"],origin:"pdf",
    };
    const classified=classifyItems([item],()=>[{category:"beverage",probability:1}]);
    expect(classified.a?.category).toBe("city_tax");
    expect(item.taxRate).toBe("19%");
    expect(item.evidenceIds).toEqual(["page-1-line-1"]);
  });
});
