import type { InvoiceDraft, SourceLine } from "../invoice/model";
import { parseCents } from "../invoice/money";

/**
 * Explicit source data needed for a future EN16931 CII mapping.
 * These fields are intentionally NOT inferred from VAT percentages, internal
 * categories, "€" characters, locale, company suffixes or the current date.
 */
export type CiiFact = { value: string; evidenceId: string };
export type CiiAddress = {
  street: CiiFact;
  postcode: CiiFact;
  city: CiiFact;
  countryCode: CiiFact;
};
export type CiiSourceFacts = {
  currency: CiiFact;
  typeCode: CiiFact;
  payable: CiiFact;
  deliveryDate: CiiFact;
  seller: CiiAddress & { vatId: CiiFact };
  buyer: CiiAddress;
  lineCodes: {category: CiiFact; unit: CiiFact}[];
};

export type CiiFactResult =
  | {ok: true; facts: CiiSourceFacts}
  | {ok: false; missing: string[]};

const LABELS = {
  currency: /^Rechnungswährung:\s*([A-Z]{3})$/i,
  typeCode: /^Rechnungstypcode:\s*(\d{3})$/i,
  payable: /^Zahlbetrag:\s*([-+]?(?:\d{1,3}(?:[., ]\d{3})+|\d+)[.,]\d{2})$/i,
  deliveryDate: /^Leistungsdatum:\s*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})$/i,
  sellerStreet: /^Aussteller Straße:\s*(.+)$/i,
  sellerPostcode: /^Aussteller PLZ:\s*(.+)$/i,
  sellerCity: /^Aussteller Ort:\s*(.+)$/i,
  sellerCountry: /^Aussteller Ländercode:\s*([A-Z]{2})$/i,
  sellerVatId: /^Aussteller USt-ID:\s*(.+)$/i,
  buyerStreet: /^Empfänger Straße:\s*(.+)$/i,
  buyerPostcode: /^Empfänger PLZ:\s*(.+)$/i,
  buyerCity: /^Empfänger Ort:\s*(.+)$/i,
  buyerCountry: /^Empfänger Ländercode:\s*([A-Z]{2})$/i,
} as const;

/** Uniqueness is essential: two identical as well as contradictory claims abstain. */
function uniqueClaim(lines: readonly SourceLine[], pattern: RegExp): CiiFact | null {
  const hits: CiiFact[] = [];
  for (const line of lines) {
    const m = pattern.exec(line.text.trim());
    if (!m?.[1]) continue;
    const value = m[1].trim();
    if (value) hits.push({value, evidenceId: line.id});
  }
  return hits.length === 1 ? hits[0]! : null;
}
function claim(lines: readonly SourceLine[], label: keyof typeof LABELS,
  missing: string[]): CiiFact | null {
  const result = uniqueClaim(lines, LABELS[label]);
  if (!result) missing.push(label);
  return result;
}

/**
 * Extraction of source-PDF CII inputs, before XML construction.
 * Today the supported labels are deliberately explicit. A missing or ambiguous
 * original is blocked instead of inventing values from document context.
 */
export function extractCiiSourceFacts(draft: InvoiceDraft): CiiFactResult {
  const {sourceLines: lines} = draft;
  const missing: string[] = [];
  if (new Set(lines.map(line => line.id)).size !== lines.length) {
    return {ok: false, missing: ["sourceLineIds"]};
  }
  const currency = claim(lines, "currency", missing);
  const typeCode = claim(lines, "typeCode", missing);
  const payable = claim(lines, "payable", missing);
  const deliveryDate = claim(lines, "deliveryDate", missing);
  const sellerStreet = claim(lines, "sellerStreet", missing);
  const sellerPostcode = claim(lines, "sellerPostcode", missing);
  const sellerCity = claim(lines, "sellerCity", missing);
  const sellerCountry = claim(lines, "sellerCountry", missing);
  const sellerVatId = claim(lines, "sellerVatId", missing);
  const buyerStreet = claim(lines, "buyerStreet", missing);
  const buyerPostcode = claim(lines, "buyerPostcode", missing);
  const buyerCity = claim(lines, "buyerCity", missing);
  const buyerCountry = claim(lines, "buyerCountry", missing);

  // Narrow first increment: EUR invoices (two decimal places) of type 380.
  // A different explicitly printed currency/type must not be silently rewritten.
  if (currency && currency.value !== "EUR") missing.push("supportedCurrency");
  if (typeCode && typeCode.value !== "380") missing.push("supportedType");
  if (payable && parseCents(payable.value) === null) missing.push("payableFormat");
  if (sellerCountry && !/^[A-Z]{2}$/.test(sellerCountry.value)) missing.push("sellerCountryCode");
  if (buyerCountry && !/^[A-Z]{2}$/.test(buyerCountry.value)) missing.push("buyerCountryCode");
  if (sellerVatId && !/^[A-Z]{2}[A-Z0-9]{2,16}$/.test(sellerVatId.value))
    missing.push("sellerVatIdFormat");

  const lineCodes = draft.items.map((item, index) => {
    // A source printed the VAT category and the invoiced unit code for
    // this very line. The item index, name and amount must all match exactly.
    const lineNumber = String(index + 1);
    const category = uniqueClaim(lines,
      new RegExp("^Position " + lineNumber +
        " USt-Kategorie:\\s*([A-Z]{1,2})\\s*\\|\\s*[^\\n]*$"));
    const unit = uniqueClaim(lines,
      new RegExp("^Position " + lineNumber +
        " Einheit:\\s*([A-Z0-9]{3})\\s*\\|\\s*[^\\n]*$"));
    // The proof line must also repeat the printed item identity + amount;
    // item order by itself must NEVER be sufficient to attach a tax code.
    const repeatsItem = (evidence: CiiFact | null): boolean => {
      const line = lines.find(line => line.id === evidence?.evidenceId)?.text ?? "";
      return line.includes("Position: " + item.description + " | Betrag: " + item.amount);
    };
    if (!category || category.value !== "S" || !repeatsItem(category))
      missing.push("items." + index + ".vatCategory");
    if (!unit || unit.value !== "C62" || !repeatsItem(unit))
      missing.push("items." + index + ".unit");
    // No VAT category is applicable to the special third-party tax evidence.
    // It requires a separate, validated EN16931 mapping later.
    if (item.taxTreatment) missing.push("items." + index + ".specialTaxTreatment");
    if (!item.amountBasis || item.amountBasis.kind !== "net")
      missing.push("items." + index + ".netBasis");
    if (parseCents(item.amount) === null || parseCents(item.unitPrice ?? "") === null)
      missing.push("items." + index + ".amount");
    if (!item.taxRate || !/^(?:7|19)%$/.test(item.taxRate))
      missing.push("items." + index + ".vatRate");
    return {category, unit};
  });
  if (draft.items.length === 0) missing.push("items");

  if (missing.length > 0 || !currency || !typeCode || !payable || !deliveryDate || !sellerStreet ||
    !sellerPostcode || !sellerCity || !sellerCountry || !sellerVatId ||
    !buyerStreet || !buyerPostcode || !buyerCity || !buyerCountry ||
    lineCodes.some(c => !c.category || !c.unit)) {
    return {ok: false, missing};
  }
  return {
    ok: true,
    facts: {
      currency, typeCode, payable, deliveryDate,
      seller: {street:sellerStreet,postcode:sellerPostcode,city:sellerCity,
        countryCode:sellerCountry,vatId:sellerVatId},
      buyer: {street:buyerStreet,postcode:buyerPostcode,city:buyerCity,
        countryCode:buyerCountry},
      lineCodes: lineCodes.map(c => ({category:c.category!,unit:c.unit!})),
    },
  };
}
