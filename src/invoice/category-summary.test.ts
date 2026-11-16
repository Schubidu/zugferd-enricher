import { describe, expect, it } from "vitest";
import { summarizeCategories } from "./category-summary";
import type { Classification } from "./classify";
import type { LineItem } from "./model";

function item(id: string, description: string, amount: string): LineItem {
  return {id, description, amount, taxRate: null, quantity: null, unitPrice: null, origin: "pdf", evidenceIds: []};
}
function manual(category: Classification["category"]): Classification {
  return {category, source:"manual", confidence:null};
}

describe("source-backed category sums", () => {
  it("groups different hotel categories and retains unknown as its own group", () => {
    const items = [
      item("1", "Logis", "105,00"),
      item("2", "Übernachtung", "125,00"),
      item("3", "Frühstück Speisen", "42,00"),
      item("4", "Getränke", "15,00"),
      item("5", "Kurtaxe", "10,50"),
      item("6", "Unbekannter Service", "18,00"),
    ];
    expect(summarizeCategories(items, {})).toEqual([
      {category:"accommodation", count:2, invalidCount:0, totalCents:23000n},
      {category:"food", count:1, invalidCount:0, totalCents:4200n},
      {category:"beverage", count:1, invalidCount:0, totalCents:1500n},
      {category:"city_tax", count:1, invalidCount:0, totalCents:1050n},
      {category:"unknown", count:1, invalidCount:0, totalCents:1800n},
    ]);
  });
  it("moves one recognized amount between categories without changing it", () => {
    const items = [item("1", "Frühstück Speisen", "42,00"), item("2", "Getränke", "15,00")];
    const first = summarizeCategories(items, {});
    const changed = summarizeCategories(items, {"1":manual("beverage")});
    expect(first.find(x=>x.category==="food")?.totalCents).toBe(4200n);
    expect(changed).toEqual([
      {category:"beverage", count:2, invalidCount:0, totalCents:5700n},
    ]);
    expect(items[0]?.amount).toBe("42,00");
  });
  it("does not fabricate a partial total for invalid amounts", () => {
    const rows = summarizeCategories([
      item("1", "Parking", "10,00"),
      item("2", "Parken", "1.234"),
      item("3", "Kurtaxe", "3,50"),
    ],{});
    expect(rows).toEqual([
      {category:"parking", count:2, invalidCount:1, totalCents:null},
      {category:"city_tax", count:1, invalidCount:0, totalCents:350n},
    ]);
  });
  it("uses exact cents for negative credits and very large values", () => {
    expect(summarizeCategories([
      item("1", "Parking", "999999999999999999,99"),
      item("2", "Parken", "-0,20"),
    ],{})).toEqual([
      {category:"parking", count:2, invalidCount:0, totalCents:99999999999999999979n},
    ]);
  });
  it("shows no category sum for missing line items", () => {
    expect(summarizeCategories([], {})).toEqual([]);
  });

  it("does not silently merge unknown lines into manually chosen other", () => {
    const items = [item("a", "X5 Zusatz", "10,00"), item("b", "Unbekannte Position", "5,00")];
    const summary = summarizeCategories(items, {a: manual("other")});
    expect(summary).toEqual([
      {category: "other", count: 1, invalidCount: 0, totalCents: 1000n},
      {category: "unknown", count: 1, invalidCount: 0, totalCents: 500n},
    ]);
  });
});
