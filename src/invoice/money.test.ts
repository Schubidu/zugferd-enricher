import { describe, expect, it } from "vitest";
import { checkTotals, formatEuroCents, parseCents, sumLineItemAmounts } from "./money";

describe("exact invoice money", () => {
  it.each([
    ["1.234,56", 123456n],
    ["1,234.56", 123456n],
    ["EUR 1.234,56", 123456n],
    ["€ 12,50", 1250n],
    ["-1.234,50 €", -123450n],
    ["0.01", 1n],
    ["999999999999999999.99", 99999999999999999999n],
  ])("parses %s as exact integer cents", (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });

  it.each(["1.234", "1,234", "12", "1.23.45", "12,3", "12.345", "1,23,45", "12abc", ""])(
    "rejects ambiguous or invalid numeric notation %s", value => {
      expect(parseCents(value)).toBeNull();
    },
  );

  it("checks stated totals without rounding errors", () => {
    expect(checkTotals("0,10", "0,20", "0,30")).toEqual({ status: "match", deltaCents: "0" });
    expect(checkTotals("100,00", "19,00", "120,00")).toEqual({ status: "mismatch", deltaCents: "-100" });
    expect(checkTotals(null, "19,00", "119,00")).toEqual({ status: "unknown" });
    expect(checkTotals("1.234", "19,00", "119,00")).toEqual({ status: "unknown" });
  });
  it("sums seven extracted hotel positions including breakfast drinks, meals and city tax without floating-point drift", () => {
    const values = ["105,00", "125,00", "118,00", "42,00", "15,00", "16,00", "10,50"];
    const summed = sumLineItemAmounts(values.map(amount => ({ amount })));
    expect(summed).toEqual({ totalCents: 43150n, itemCount: 7, invalidCount: 0 });
    expect(formatEuroCents(summed.totalCents!)).toBe("431,50 €");
    // This is the sum of the invoice's *net* positions plus exempt city tax,
    // not the invoice's gross total (which includes 33,19 VAT).
    expect(summed.totalCents).not.toBe(parseCents("464,69"));
  });

  it("handles international number notation, rounding-sensitive cents and credits", () => {
    const total = sumLineItemAmounts([
      { amount: "1,234.56" }, { amount: "0,10" }, { amount: "0,20" }, { amount: "-4,86" },
    ]);
    expect(total.totalCents).toBe(123000n);
    expect(formatEuroCents(total.totalCents!)).toBe("1.230,00 €");
    expect(formatEuroCents(-100020n)).toBe("-1.000,20 €");
    expect(formatEuroCents(0n)).toBe("0,00 €");
  });

  it("never reports a partial sum when any position amount is invalid or absent", () => {
    expect(sumLineItemAmounts([])).toEqual({ totalCents: null, itemCount: 0, invalidCount: 0 });
    expect(sumLineItemAmounts([{ amount: "3,50" }, { amount: "" }, { amount: "1.234" }])).toEqual({
      totalCents: null, itemCount: 3, invalidCount: 2,
    });
  });
});
