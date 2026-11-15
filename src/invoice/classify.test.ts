import { describe, expect, it } from "vitest";
import { classifyDescription, classifyItems } from "./classify";
import type { LineItem } from "./model";

const examples: Array<[string,string]> = [
  ["Übernachtung 14.11.", "accommodation"],
  ["Logis Einzelzimmer", "accommodation"],
  ["Breakfast food", "food"],
  ["Konferenzlunch", "food"],
  ["Konferenz-Lunch", "food"],
  ["Tagungslunch", "food"],
  ["Frühstück Getränke", "beverage"],
  ["Frühstücksgetränke", "beverage"],
  ["Frühstück Getränke 15.11.2026", "beverage"],
  ["Breakfast drinks", "beverage"],
  ["Frühstück Speisen", "food"],
  ["Mineralwasser Getränke", "beverage"],
  ["Coffee", "beverage"],
  ["Parken Garage", "parking"],
  ["Parking", "parking"],
  ["Kurtaxe", "city_tax"],
  ["Beherbergungssteuer", "city_tax"],
  ["Business Paket", "bundle"],
  ["Arrangement", "bundle"],

  // Common German and English hotel invoice wording, with conservative scope.
  ["Zimmerübernachtung", "accommodation"],
  ["Zimmerpreis Einzelzimmer", "accommodation"],
  ["Übernachtungsentgelt", "accommodation"],
  ["Room charge", "accommodation"],
  ["Unterkunft", "accommodation"],
  ["Business Lunch", "food"],
  ["Meeting-Lunch", "food"],
  ["Seminarlunch", "food"],
  ["Mittagsmenü", "food"],
  ["Tagesgericht", "food"],
  ["Abendmenü", "food"],
  ["Frühstück Essen", "food"],
  ["Frühstücksspeisen", "food"],
  ["Frühstück-Getränke", "beverage"],
  ["Frühstück: Getränke", "beverage"],
  ["Frühstück Getränkeanteil", "beverage"],
  ["Getränke zum Frühstück", "beverage"],
  ["Getränkeanteil Frühstück", "beverage"],
  ["Breakfast beverages", "beverage"],
  ["Cappuccino", "beverage"],
  ["Espresso", "beverage"],
  ["Latte Macchiato", "beverage"],
  ["Orangensaft", "beverage"],
  ["Parkgebühr", "parking"],
  ["Parkplatzmiete", "parking"],
  ["Stellplatzgebühr", "parking"],
  ["Tiefgarage", "parking"],
  ["City-Tax", "city_tax"],
  ["Übernachtungssteuer", "city_tax"],
  ["Touristensteuer", "city_tax"],
  ["Kulturförderabgabe", "city_tax"],
  ["Kurbeitrag", "city_tax"],
  ["Gästebeitrag", "city_tax"],
  ["Tagungspauschale", "bundle"],
  ["Halbpension", "bundle"],
  ["Vollpension", "bundle"],
  ["Frühstückspauschale", "bundle"],

];
describe("conservative source-separated classification", () => {
  it.each(examples)("applies explicit high-precision rules: %s", (text, expected) => {
    expect(classifyDescription(text)).toMatchObject({category:expected,source:"rule"});
  });
  it("abstains on mixed services and unfamiliar descriptions", () => {
    expect(classifyDescription("Frühstück und Getränke").category).toBe("unknown");
    expect(classifyDescription("Frühstück Getränke und Speisen").category).toBe("unknown");
    expect(classifyDescription("Lunch und Getränke").category).toBe("unknown");

    // Do not incorrectly assume that a mixed arrangement is a single tax group.
    expect(classifyDescription("Übernachtung inkl. Frühstück").category).toBe("unknown");
    expect(classifyDescription("Konferenzlunch und Getränke").category).toBe("unknown");
    expect(classifyDescription("Business Lunch mit Cappuccino").category).toBe("unknown");
    expect(classifyDescription("Frühstück Speisen und Getränke").category).toBe("unknown");
    // Word boundaries matter: a word containing "wein" or "lunch" is not automatically a drink or meal.
    expect(classifyDescription("Schweinefilet Zusatzposten").category).toBe("unknown");
    expect(classifyDescription("Lunchtime Konferenzservice").category).toBe("unknown");

    expect(classifyDescription("X5 Zusatz")).toMatchObject({category:"unknown",source:"abstain"});
  });
  it("accepts a confident, unambiguous local model prediction", () => {
    expect(classifyDescription("Unbekannte Serviceposition X5", [
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

  it.each([
    // Exactly the described line items in synthetic TEST-01 and TEST-02.
    ["Beratungsleistung", "service"],
    ["Designhandbuch Band A", "books"],
    ["Fachbuch UI Patterns", "books"],
    ["Monitorhalterung", "hardware"],
    ["Installation vor Ort", "service"],
    ["USB-C Hub", "hardware"],
    ["Dokumentenmappe", "office_supplies"],
  ])("offers an unconfirmed category for a general invoice line: %s", (description, expected) => {
    const classification = classifyDescription(description);
    expect(classification).toMatchObject({category: expected, source: "rule"});
    expect(getCategoryReviewStatus(classification)).toBe("suggested");
  });
  it("keeps unknown separate from consciously selected other", () => {
    const abstained = classifyDescription("X5 Zusatz", [
      {category: "other", probability: 0.99},
    ]);
    expect(abstained).toMatchObject({category: "unknown", source: "abstain"});
    expect(getCategoryReviewStatus(abstained)).toBe("unknown");
    expect(getCategoryReviewStatus({category: "other", source: "manual", confidence: null})).toBe("confirmed");
    expect(getCategoryReviewStatus({category: "unknown", source: "manual", confidence: null})).toBe("unknown");
    expect(getCategoryReviewStatus({category: "parking", source: "fasttext", confidence: 0.99})).toBe("suggested");
  });
});
