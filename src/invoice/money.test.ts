import { describe, expect, it } from "vitest";
import { checkTotals, parseCents } from "./money";

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
});
